/**
 * MQTT auth service: HTTP backend for Mosquitto auth plugin.
 * CONNECT validates SIWE-style EIP-191 `personal_sign` over
 * `clanker-mqtt:auth:<bot_id>:<nonce>` (password = `<nonce>.<sigHex>`).
 * Bot/operator status is read from ClankerIdentity via RPC.
 */

import { recoverMessageAddress, type Address } from "viem";
import { RegistryClient } from "@clanker-chain/identity-node-client";

const CHAIN_RPC_URL =
  process.env.CHAIN_RPC_URL ?? Bun.env.CHAIN_RPC_URL ?? "";
const REGISTRY_ADDRESS = (process.env.REGISTRY_ADDRESS ??
  Bun.env.REGISTRY_ADDRESS ??
  "") as Address;
const PORT = process.env.MQTT_AUTH_PORT ? Number(process.env.MQTT_AUTH_PORT) : 9090;
const NONCE_TTL_MS =
  Number(process.env.MQTT_NONCE_TTL_MS ?? Bun.env.MQTT_NONCE_TTL_MS ?? 300_000) || 300_000;
const REAPER_MS = 60_000;
const NONCE_RATE_WINDOW_MS = 60_000;
const NONCE_RATE_MAX =
  Number(process.env.MQTT_NONCE_RATE_MAX ?? Bun.env.MQTT_NONCE_RATE_MAX ?? 30) || 30;
// Auth gate: default uncached so revoke / rotateBotKey take effect on the next CONNECT.
// Live sessions are not dropped (/acl allow-all). Set REGISTRY_CACHE_TTL_MS>0 only if
// public RPC rate limits require it.
const registryCacheParsed = Number(
  process.env.REGISTRY_CACHE_TTL_MS ?? Bun.env.REGISTRY_CACHE_TTL_MS ?? 0,
);
const REGISTRY_CACHE_TTL_MS = Number.isFinite(registryCacheParsed)
  ? Math.max(0, registryCacheParsed)
  : 0;
// Shared by /health and /auth registry reads. Raise for slow public RPCs
// (e.g. CHAIN_RPC_TIMEOUT_MS=10000) if CONNECT sees registry_unavailable.
const CHAIN_RPC_TIMEOUT_MS =
  Number(process.env.CHAIN_RPC_TIMEOUT_MS ?? Bun.env.CHAIN_RPC_TIMEOUT_MS ?? 3_000) ||
  3_000;

if (!CHAIN_RPC_URL || !/^0x[0-9a-fA-F]{40}$/.test(REGISTRY_ADDRESS ?? "")) {
  console.error(
    "mqtt-auth-service requires CHAIN_RPC_URL and REGISTRY_ADDRESS (0x + 40 hex, ClankerIdentity).",
  );
  process.exit(1);
}

const registry = new RegistryClient({
  rpcUrl: CHAIN_RPC_URL,
  registryAddress: REGISTRY_ADDRESS,
  cacheTtlMs: REGISTRY_CACHE_TTL_MS,
  rpcTimeoutMs: CHAIN_RPC_TIMEOUT_MS,
});

interface NonceEntry {
  botId: string;
  expiresAt: number;
  used: boolean;
}

const nonces = new Map<string, NonceEntry>();
const nonceIssueTimes = new Map<string, number[]>();

function randomNonceToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString("base64url");
}

function buildAuthMessage(botId: string, nonce: string): string {
  return `clanker-mqtt:auth:${botId}:${nonce}`;
}

function pruneExpiredNonces(): void {
  const now = Date.now();
  for (const [k, v] of nonces) {
    if (v.expiresAt < now) nonces.delete(k);
  }
}

function checkNonceRateLimit(botId: string): boolean {
  const now = Date.now();
  const prev = nonceIssueTimes.get(botId) ?? [];
  const recent = prev.filter((t) => now - t < NONCE_RATE_WINDOW_MS);
  if (recent.length >= NONCE_RATE_MAX) {
    nonceIssueTimes.set(botId, recent);
    return false;
  }
  recent.push(now);
  nonceIssueTimes.set(botId, recent);
  return true;
}

setInterval(() => {
  pruneExpiredNonces();
}, REAPER_MS);

/** SIWE-style password: exactly one `.`, tail is 65-byte ECDSA sig (0x + 130 hex). */
function looksLikeSiwePassword(password: string): boolean {
  const first = password.indexOf(".");
  if (first < 0) return false;
  if (password.indexOf(".", first + 1) >= 0) return false;
  const sigHex = password.slice(first + 1);
  if (!sigHex.startsWith("0x") || sigHex.length !== 132) return false;
  return /^0x[0-9a-fA-F]{130}$/.test(sigHex);
}

async function verifyMqttSiwe(
  botId: string,
  password: string,
): Promise<{ ok: boolean; error?: string }> {
  const first = password.indexOf(".");
  const nonce = password.slice(0, first);
  const sigHex = password.slice(first + 1) as `0x${string}`;
  const entry = nonces.get(nonce);
  const now = Date.now();
  if (!entry || entry.used || entry.expiresAt < now || entry.botId !== botId) {
    return { ok: false, error: "bad_nonce" };
  }
  const message = buildAuthMessage(botId, nonce);
  let recovered: `0x${string}`;
  try {
    recovered = await recoverMessageAddress({ message, signature: sigHex });
  } catch {
    return { ok: false, error: "invalid_signature" };
  }

  let bot;
  try {
    bot = await registry.getBotByLabel(botId);
  } catch (e) {
    console.warn("[mqtt-auth] registry getBotByLabel failed", e);
    return { ok: false, error: "registry_unavailable" };
  }
  if (!bot || bot.status !== "active") {
    return { ok: false, error: "bot_not_active" };
  }

  let operator;
  try {
    operator = await registry.getOperatorById(bot.operatorId);
  } catch (e) {
    console.warn("[mqtt-auth] registry getOperatorById failed", e);
    return { ok: false, error: "registry_unavailable" };
  }
  if (!operator || operator.status !== "active") {
    return { ok: false, error: "operator_not_active" };
  }

  if (!bot.botKey || bot.botKey === "0x0000000000000000000000000000000000000000") {
    return { ok: false, error: "no_onchain_key" };
  }
  if (recovered.toLowerCase() !== bot.botKey.toLowerCase()) {
    return { ok: false, error: "address_mismatch" };
  }
  entry.used = true;
  return { ok: true };
}

async function parseAuthRequest(
  request: Request,
): Promise<{ username: string; password: string } | null> {
  const url = new URL(request.url);
  if (request.method === "GET") {
    const username = url.searchParams.get("username");
    const password = url.searchParams.get("password");
    if (username !== null && password !== null) return { username, password };
    return null;
  }
  if (request.method === "POST") {
    const contentType = request.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      try {
        const body = (await request.json()) as Record<string, unknown>;
        const username = typeof body.username === "string" ? body.username : null;
        const password = typeof body.password === "string" ? body.password : null;
        return username !== null && password !== null ? { username, password } : null;
      } catch {
        return null;
      }
    }
    if (contentType.includes("application/x-www-form-urlencoded")) {
      const form = await request.formData();
      const username = form.get("username");
      const password = form.get("password");
      const u = typeof username === "string" ? username : null;
      const p = typeof password === "string" ? password : null;
      return u !== null && p !== null ? { username: u, password: p } : null;
    }
  }
  return null;
}

function parseBotIdFromNonceRequest(url: URL): string | null {
  const q = url.searchParams.get("bot_id");
  if (q) return q;
  return null;
}

async function handleNonce(request: Request): Promise<Response> {
  if (request.method !== "GET" && request.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }
  let botId: string | null = null;
  if (request.method === "GET") {
    botId = parseBotIdFromNonceRequest(new URL(request.url));
  } else {
    try {
      const ct = request.headers.get("content-type") ?? "";
      if (ct.includes("application/json")) {
        const body = (await request.json()) as { bot_id?: string };
        botId = typeof body.bot_id === "string" ? body.bot_id : null;
      } else if (ct.includes("application/x-www-form-urlencoded")) {
        const fd = await request.formData();
        const v = fd.get("bot_id");
        botId = typeof v === "string" ? v : null;
      }
    } catch {
      botId = null;
    }
  }
  if (!botId) {
    return jsonErr(400, "missing_bot_id");
  }
  if (!checkNonceRateLimit(botId)) {
    return jsonErr(429, "rate_limited");
  }
  const nonce = randomNonceToken();
  const expiresAt = Date.now() + NONCE_TTL_MS;
  nonces.set(nonce, { botId, expiresAt, used: false });
  const message = buildAuthMessage(botId, nonce);
  return json(200, {
    nonce,
    expires_at: new Date(expiresAt).toISOString(),
    message,
  });
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function jsonErr(status: number, code: string): Response {
  return json(status, { error: code });
}

const server = Bun.serve({
  port: PORT,
  async fetch(request: Request) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/$/, "") || "/";

    if (path === "/nonce") {
      return handleNonce(request);
    }

    if (path === "/auth") {
      const body = await parseAuthRequest(request);
      if (!body) {
        return new Response("Forbidden", { status: 403 });
      }
      const { username, password } = body;
      if (!looksLikeSiwePassword(password)) {
        return new Response("invalid_password_format", { status: 403 });
      }
      const result = await verifyMqttSiwe(username, password);
      if (result.ok) {
        return new Response("OK", { status: 200 });
      }
      return new Response(result.error ?? "Forbidden", { status: 403 });
    }

    if (path === "/acl" || path === "/acl/") {
      return new Response("OK", { status: 200 });
    }

    if (path === "/health" || path === "/") {
      try {
        // Uncached eth_chainId + eth_blockNumber — getChainId() alone is memoized.
        const { chainId, blockNumber } = await registry.probeRpc();
        return json(200, {
          ok: true,
          chainId,
          blockNumber: blockNumber.toString(),
          registryAddress: REGISTRY_ADDRESS,
        });
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        return json(503, {
          ok: false,
          error: "registry_unavailable",
          message,
        });
      }
    }

    return new Response("Not Found", { status: 404 });
  },
});

console.log(`MQTT auth service listening on port ${server.port}`);
console.log(`CHAIN_RPC_URL=${CHAIN_RPC_URL}`);
console.log(`REGISTRY_ADDRESS=${REGISTRY_ADDRESS}`);

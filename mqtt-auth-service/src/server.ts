/**
 * MQTT auth service: HTTP backend for Mosquitto auth plugin.
 * CONNECT validates SIWE-style EIP-191 `personal_sign` over
 * `clanker-mqtt:auth:<bot_id>:<nonce>` (password = `<nonce>.<sigHex>`).
 */

import { recoverMessageAddress } from "viem";

const IDENTITY_SERVICE_URL =
  process.env.IDENTITY_SERVICE_URL ?? Bun.env.IDENTITY_SERVICE_URL ?? "http://localhost:8080";
const PORT = process.env.MQTT_AUTH_PORT ? Number(process.env.MQTT_AUTH_PORT) : 9090;
const NONCE_TTL_MS =
  Number(process.env.MQTT_NONCE_TTL_MS ?? Bun.env.MQTT_NONCE_TTL_MS ?? 300_000) || 300_000;
const REAPER_MS = 60_000;
const NONCE_RATE_WINDOW_MS = 60_000;
const NONCE_RATE_MAX =
  Number(process.env.MQTT_NONCE_RATE_MAX ?? Bun.env.MQTT_NONCE_RATE_MAX ?? 30) || 30;

interface BotRecord {
  bot_id: string;
  operator_id?: string;
  public_keys?: Array<{
    algorithm: string;
    public_key: string;
    status: string;
  }>;
  status?: string;
}

interface OperatorRecord {
  operator_id: string;
  status?: string;
}

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

async function fetchBot(botId: string): Promise<BotRecord | null> {
  const url = `${IDENTITY_SERVICE_URL}/v1/bots/${encodeURIComponent(botId)}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  return (await res.json()) as BotRecord;
}

async function fetchOperator(operatorId: string): Promise<OperatorRecord | null> {
  const url = `${IDENTITY_SERVICE_URL}/v1/operators/${encodeURIComponent(operatorId)}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  return (await res.json()) as OperatorRecord;
}

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
  const bot = await fetchBot(botId);
  if (!bot || bot.status !== "active") {
    return { ok: false, error: "bot_not_active" };
  }
  if (bot.operator_id) {
    const operator = await fetchOperator(bot.operator_id);
    if (!operator || operator.status !== "active") {
      return { ok: false, error: "operator_not_active" };
    }
  }
  const onchainKey = bot.public_keys?.find(
    (k) => k.algorithm === "secp256k1-eth" && k.status === "active",
  )?.public_key;
  if (!onchainKey?.startsWith("0x")) {
    return { ok: false, error: "no_onchain_key" };
  }
  if (recovered.toLowerCase() !== onchainKey.toLowerCase()) {
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
  return json(
    200,
    {
      nonce,
      expires_at: new Date(expiresAt).toISOString(),
      message,
    },
  );
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
      return new Response("ok", { status: 200 });
    }

    return new Response("Not Found", { status: 404 });
  },
});

console.log(`MQTT auth service listening on port ${server.port}`);
console.log(`IDENTITY_SERVICE_URL=${IDENTITY_SERVICE_URL}`);

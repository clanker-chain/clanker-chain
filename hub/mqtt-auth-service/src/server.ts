/**
 * MQTT auth service: HTTP backend for Mosquitto auth plugin.
 * CONNECT validates SIWE-style EIP-191 `personal_sign` over
 * `clanker-mqtt:auth:<bot_id>:<nonce>` (password = `<nonce>.<sigHex>`).
 * Bot/operator status is read from ClankerIdentity via RPC.
 *
 * Facts · Policy · Transport (docs/trust-model.md):
 * - /auth = Facts (botKey + active)
 * - /pair* = Policy (operator-keyed allow-list)
 * - /acl = Transport (default-deny topic rules)
 */

import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { recoverMessageAddress, type Address, type Hex } from "viem";
import { RegistryClient, registryLabelToId } from "@clanker-chain/identity-node-client";
import { evaluateAcl, type Acc } from "./acl.js";
import { PairingStore } from "./pairing-store.js";

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
const registryCacheParsed = Number(
  process.env.REGISTRY_CACHE_TTL_MS ?? Bun.env.REGISTRY_CACHE_TTL_MS ?? 0,
);
const REGISTRY_CACHE_TTL_MS = Number.isFinite(registryCacheParsed)
  ? Math.max(0, registryCacheParsed)
  : 0;
const CHAIN_RPC_TIMEOUT_MS =
  Number(process.env.CHAIN_RPC_TIMEOUT_MS ?? Bun.env.CHAIN_RPC_TIMEOUT_MS ?? 3_000) ||
  3_000;
const PAIRING_STORE_PATH =
  process.env.PAIRING_STORE_PATH ??
  Bun.env.PAIRING_STORE_PATH ??
  join(process.cwd(), "data", "pairing.json");

if (!CHAIN_RPC_URL || !/^0x[0-9a-fA-F]{40}$/.test(REGISTRY_ADDRESS ?? "")) {
  console.error(
    "mqtt-auth-service requires CHAIN_RPC_URL and REGISTRY_ADDRESS (0x + 40 hex, ClankerIdentity).",
  );
  process.exit(1);
}

mkdirSync(dirname(PAIRING_STORE_PATH), { recursive: true });

const registry = new RegistryClient({
  rpcUrl: CHAIN_RPC_URL,
  registryAddress: REGISTRY_ADDRESS,
  cacheTtlMs: REGISTRY_CACHE_TTL_MS,
  rpcTimeoutMs: CHAIN_RPC_TIMEOUT_MS,
});

const pairing = new PairingStore(PAIRING_STORE_PATH);

interface NonceEntry {
  subject: string;
  kind: "bot" | "operator";
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

function buildPairMessage(
  operatorId: string,
  action: string,
  peer: string,
  nonce: string,
): string {
  return `clanker-mqtt:pair:${operatorId}:${action}:${peer}:${nonce}`;
}

function pruneExpiredNonces(): void {
  const now = Date.now();
  for (const [k, v] of nonces) {
    if (v.expiresAt < now) nonces.delete(k);
  }
}

function checkNonceRateLimit(key: string): boolean {
  const now = Date.now();
  const prev = nonceIssueTimes.get(key) ?? [];
  const recent = prev.filter((t) => now - t < NONCE_RATE_WINDOW_MS);
  if (recent.length >= NONCE_RATE_MAX) {
    nonceIssueTimes.set(key, recent);
    return false;
  }
  recent.push(now);
  nonceIssueTimes.set(key, recent);
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
  if (
    !entry ||
    entry.kind !== "bot" ||
    entry.used ||
    entry.expiresAt < now ||
    entry.subject !== botId
  ) {
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

async function parseAclRequest(
  request: Request,
): Promise<{ username: string; topic: string; acc: Acc; clientid?: string } | null> {
  if (request.method === "GET") {
    const url = new URL(request.url);
    const username = url.searchParams.get("username");
    const topic = url.searchParams.get("topic");
    const accRaw = url.searchParams.get("acc");
    const clientid = url.searchParams.get("clientid") ?? undefined;
    if (username === null || topic === null || accRaw === null) return null;
    const acc = Number(accRaw);
    if (!Number.isFinite(acc)) return null;
    return { username, topic, acc, clientid: clientid ?? undefined };
  }
  if (request.method === "POST") {
    const contentType = request.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      try {
        const body = (await request.json()) as Record<string, unknown>;
        const username = typeof body.username === "string" ? body.username : null;
        const topic = typeof body.topic === "string" ? body.topic : null;
        const acc = typeof body.acc === "number" ? body.acc : Number(body.acc);
        const clientid = typeof body.clientid === "string" ? body.clientid : undefined;
        if (username === null || topic === null || !Number.isFinite(acc)) return null;
        return { username, topic, acc, clientid };
      } catch {
        return null;
      }
    }
    if (contentType.includes("application/x-www-form-urlencoded")) {
      const form = await request.formData();
      const username = form.get("username");
      const topic = form.get("topic");
      const accRaw = form.get("acc");
      const clientid = form.get("clientid");
      const u = typeof username === "string" ? username : null;
      const t = typeof topic === "string" ? topic : null;
      const a = typeof accRaw === "string" ? Number(accRaw) : Number(accRaw);
      if (u === null || t === null || !Number.isFinite(a)) return null;
      return {
        username: u,
        topic: t,
        acc: a,
        clientid: typeof clientid === "string" ? clientid : undefined,
      };
    }
  }
  return null;
}

async function handleNonce(request: Request): Promise<Response> {
  if (request.method !== "GET" && request.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }
  let botId: string | null = null;
  if (request.method === "GET") {
    botId = new URL(request.url).searchParams.get("bot_id");
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
  if (!checkNonceRateLimit(`bot:${botId}`)) {
    return jsonErr(429, "rate_limited");
  }
  const nonce = randomNonceToken();
  const expiresAt = Date.now() + NONCE_TTL_MS;
  nonces.set(nonce, { subject: botId, kind: "bot", expiresAt, used: false });
  const message = buildAuthMessage(botId, nonce);
  return json(200, {
    nonce,
    expires_at: new Date(expiresAt).toISOString(),
    message,
  });
}

async function handlePairNonce(request: Request): Promise<Response> {
  if (request.method !== "GET" && request.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }
  let operatorId: string | null = null;
  let action: string | null = null;
  let peerLabel: string | null = null;
  if (request.method === "GET") {
    const url = new URL(request.url);
    operatorId = url.searchParams.get("operator_id");
    action = url.searchParams.get("action");
    peerLabel = url.searchParams.get("peer_label") ?? url.searchParams.get("peer_operator_id");
  } else {
    try {
      const body = (await request.json()) as {
        operator_id?: string;
        action?: string;
        peer_label?: string;
        peer_operator_id?: string;
      };
      operatorId = typeof body.operator_id === "string" ? body.operator_id : null;
      action = typeof body.action === "string" ? body.action : null;
      peerLabel =
        typeof body.peer_label === "string"
          ? body.peer_label
          : typeof body.peer_operator_id === "string"
            ? body.peer_operator_id
            : null;
    } catch {
      operatorId = null;
    }
  }
  if (!operatorId) {
    return jsonErr(400, "missing_operator_id");
  }
  if (!action || !["add", "remove", "list"].includes(action)) {
    return jsonErr(400, "bad_action");
  }
  if ((action === "add" || action === "remove") && !peerLabel) {
    return jsonErr(400, "missing_peer");
  }
  if (!checkNonceRateLimit(`op:${operatorId}`)) {
    return jsonErr(429, "rate_limited");
  }
  const nonce = randomNonceToken();
  const expiresAt = Date.now() + NONCE_TTL_MS;
  nonces.set(nonce, { subject: operatorId, kind: "operator", expiresAt, used: false });
  const message =
    action === "list"
      ? `clanker-mqtt:pair-list:${operatorId}:${nonce}`
      : buildPairMessage(operatorId, action, peerLabel!, nonce);
  return json(200, {
    nonce,
    expires_at: new Date(expiresAt).toISOString(),
    message,
  });
}

function resolveOperatorIdHex(labelOrId: string): Hex {
  if (/^0x[0-9a-fA-F]{64}$/.test(labelOrId)) {
    return labelOrId.toLowerCase() as Hex;
  }
  return registryLabelToId(labelOrId);
}

async function handlePairPost(request: Request): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return jsonErr(400, "invalid_json");
  }

  const operatorLabel =
    typeof body.operator_id === "string"
      ? body.operator_id
      : typeof body.operator_label === "string"
        ? body.operator_label
        : null;
  const peerLabel =
    typeof body.peer_label === "string"
      ? body.peer_label
      : typeof body.peer_operator_id === "string"
        ? body.peer_operator_id
        : null;
  const action = typeof body.action === "string" ? body.action : null;
  const nonce = typeof body.nonce === "string" ? body.nonce : null;
  const signature = typeof body.signature === "string" ? body.signature : null;

  if (!operatorLabel || !peerLabel || !action || !nonce || !signature) {
    return jsonErr(400, "missing_fields");
  }
  if (action !== "add" && action !== "remove") {
    return jsonErr(400, "bad_action");
  }
  if (!/^0x[0-9a-fA-F]{130}$/.test(signature)) {
    return jsonErr(400, "bad_signature");
  }

  const entry = nonces.get(nonce);
  const now = Date.now();
  if (
    !entry ||
    entry.kind !== "operator" ||
    entry.used ||
    entry.expiresAt < now ||
    entry.subject !== operatorLabel
  ) {
    return jsonErr(403, "bad_nonce");
  }

  const ownerId = resolveOperatorIdHex(operatorLabel);
  const peerId = resolveOperatorIdHex(peerLabel);
  const message = buildPairMessage(operatorLabel, action, peerLabel, nonce);

  let recovered: `0x${string}`;
  try {
    recovered = await recoverMessageAddress({
      message,
      signature: signature as `0x${string}`,
    });
  } catch {
    return jsonErr(403, "invalid_signature");
  }

  let operator;
  try {
    operator = await registry.getOperatorById(ownerId);
  } catch {
    return jsonErr(503, "registry_unavailable");
  }
  if (!operator || operator.status !== "active") {
    return jsonErr(403, "operator_not_active");
  }
  if (recovered.toLowerCase() !== operator.owner.toLowerCase()) {
    return jsonErr(403, "address_mismatch");
  }

  // Peer must exist as an active operator when adding
  if (action === "add") {
    let peerOp;
    try {
      peerOp = await registry.getOperatorById(peerId);
    } catch {
      return jsonErr(503, "registry_unavailable");
    }
    if (!peerOp || peerOp.status !== "active") {
      return jsonErr(400, "peer_not_active");
    }
  }

  entry.used = true;

  const displayLabel = /^0x[0-9a-fA-F]{64}$/.test(operatorLabel)
    ? pairing.get(ownerId).label || operatorLabel
    : operatorLabel;

  const updated =
    action === "add"
      ? pairing.addOperator(ownerId, displayLabel, peerId)
      : pairing.removeOperator(ownerId, peerId);

  const mutual = pairing.isMutual(ownerId, peerId);

  return json(200, {
    ok: true,
    action,
    operator_id: ownerId,
    operator_label: displayLabel,
    peer_operator_id: peerId,
    peer_label: peerLabel,
    mutual,
    allowOperatorIds: updated.allowOperatorIds,
  });
}

async function handlePairGet(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const operatorLabel = url.searchParams.get("operator_id");
  const nonce = url.searchParams.get("nonce");
  const signature = url.searchParams.get("signature");
  if (!operatorLabel || !nonce || !signature) {
    return jsonErr(400, "missing_fields");
  }
  if (!/^0x[0-9a-fA-F]{130}$/.test(signature)) {
    return jsonErr(400, "bad_signature");
  }

  const entry = nonces.get(nonce);
  const now = Date.now();
  if (
    !entry ||
    entry.kind !== "operator" ||
    entry.used ||
    entry.expiresAt < now ||
    entry.subject !== operatorLabel
  ) {
    return jsonErr(403, "bad_nonce");
  }

  const ownerId = resolveOperatorIdHex(operatorLabel);
  const message = `clanker-mqtt:pair-list:${operatorLabel}:${nonce}`;
  let recovered: `0x${string}`;
  try {
    recovered = await recoverMessageAddress({
      message,
      signature: signature as `0x${string}`,
    });
  } catch {
    return jsonErr(403, "invalid_signature");
  }

  let operator;
  try {
    operator = await registry.getOperatorById(ownerId);
  } catch {
    return jsonErr(503, "registry_unavailable");
  }
  if (!operator || operator.status !== "active") {
    return jsonErr(403, "operator_not_active");
  }
  if (recovered.toLowerCase() !== operator.owner.toLowerCase()) {
    return jsonErr(403, "address_mismatch");
  }

  entry.used = true;
  const listed = pairing.list(ownerId);
  const allows = listed.allowOperatorIds.map((peerId) => ({
    peer_operator_id: peerId,
    mutual: pairing.isMutual(ownerId, peerId),
  }));

  return json(200, {
    operator_id: ownerId,
    operator_label: listed.label || operatorLabel,
    allowOperatorIds: listed.allowOperatorIds,
    allowBotIds: listed.allowBotIds,
    allows,
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

/** Site origins allowed to call public /pair* from a browser (Policy). */
const PAIR_CORS_ORIGINS = new Set([
  "https://clanker-chain.com",
  "https://www.clanker-chain.com",
]);

function pairCorsOrigin(request: Request): string | null {
  const origin = request.headers.get("origin");
  if (!origin) return null;
  if (PAIR_CORS_ORIGINS.has(origin)) return origin;
  // No any-localhost allow on production — CLI /pair has no Origin header.
  return null;
}

function withPairCors(request: Request, response: Response): Response {
  const origin = pairCorsOrigin(request);
  if (!origin) return response;
  const headers = new Headers(response.headers);
  headers.set("Access-Control-Allow-Origin", origin);
  headers.set("Vary", "Origin");
  headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  headers.set("Access-Control-Allow-Headers", "content-type");
  headers.set("Access-Control-Max-Age", "86400");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function isPairPath(path: string): boolean {
  return path === "/pair" || path === "/pair-nonce";
}

const server = Bun.serve({
  port: PORT,
  async fetch(request: Request) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/$/, "") || "/";

    if (isPairPath(path) && request.method === "OPTIONS") {
      return withPairCors(request, new Response(null, { status: 204 }));
    }

    if (path === "/nonce") {
      return handleNonce(request);
    }

    if (path === "/pair-nonce") {
      return withPairCors(request, await handlePairNonce(request));
    }

    if (path === "/pair") {
      if (request.method === "POST") {
        return withPairCors(request, await handlePairPost(request));
      }
      if (request.method === "GET") {
        return withPairCors(request, await handlePairGet(request));
      }
      return withPairCors(
        request,
        new Response("Method Not Allowed", { status: 405 }),
      );
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

    if (path === "/acl") {
      const body = await parseAclRequest(request);
      if (!body) {
        return new Response("Forbidden", { status: 403 });
      }
      const decision = await evaluateAcl(body, registry, pairing);
      if (decision.ok) {
        return new Response("OK", { status: 200 });
      }
      return new Response(decision.reason, { status: 403 });
    }

    if (path === "/health" || path === "/") {
      try {
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
console.log(`PAIRING_STORE_PATH=${PAIRING_STORE_PATH}`);

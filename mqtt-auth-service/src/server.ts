/**
 * MQTT auth service: HTTP backend for Mosquitto auth plugin.
 * Validates CONNECT by verifying Ed25519-signed JWT (password) against
 * the identity service (username = bot_id).
 */

const IDENTITY_SERVICE_URL =
  process.env.IDENTITY_SERVICE_URL ?? "http://localhost:8080";
const PORT = process.env.MQTT_AUTH_PORT ? Number(process.env.MQTT_AUTH_PORT) : 9090;
const MQTT_TOKEN_AUD = "clanker-mqtt";

function base64ToBase64url(b64: string): string {
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

interface BotRecord {
  bot_id: string;
  public_keys?: Array<{
    algorithm: string;
    public_key: string;
    status: string;
  }>;
  status?: string;
}

async function getBotPublicKey(botId: string): Promise<string | null> {
  const url = `${IDENTITY_SERVICE_URL}/v1/bots/${encodeURIComponent(botId)}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const bot = (await res.json()) as BotRecord;
  if (bot.status !== "active") return null;
  const key = bot.public_keys?.find(
    (k) => k.algorithm === "ed25519" && k.status === "active"
  );
  return key?.public_key ?? null;
}

async function verifyMqttToken(
  token: string,
  botId: string
): Promise<{ ok: boolean; error?: string }> {
  const { jwtVerify, importJWK } = await import("jose");

  const publicKeyBase64 = await getBotPublicKey(botId);
  if (!publicKeyBase64) {
    return { ok: false, error: "bot not found or no active key" };
  }

  const pubBytes = Buffer.from(publicKeyBase64, "base64");
  if (pubBytes.length !== 32) {
    return { ok: false, error: "invalid key length" };
  }
  const jwk = {
    kty: "OKP" as const,
    crv: "Ed25519" as const,
    x: base64ToBase64url(pubBytes.toString("base64")),
  };
  const key = await importJWK(jwk, "EdDSA");
  if (!key) {
    return { ok: false, error: "failed to import key" };
  }

  try {
    const { payload } = await jwtVerify(token, key, {
      algorithms: ["EdDSA"],
      audience: MQTT_TOKEN_AUD,
    });
    const sub = payload.sub;
    if (typeof sub !== "string" || sub !== botId) {
      return { ok: false, error: "subject mismatch" };
    }
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg };
  }
}

async function parseAuthRequest(
  request: Request
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

const server = Bun.serve({
  port: PORT,
  async fetch(request: Request) {
    const url = new URL(request.url);
    if (url.pathname === "/auth" || url.pathname === "/auth/") {
      const body = await parseAuthRequest(request);
      if (!body) {
        return new Response("Forbidden", { status: 403 });
      }
      const { username, password } = body;
      const result = await verifyMqttToken(password, username);
      if (result.ok) {
        return new Response("OK", { status: 200 });
      }
      return new Response(result.error ?? "Forbidden", { status: 403 });
    }

    if (url.pathname === "/acl" || url.pathname === "/acl/") {
      // Optional: implement ACL checks per bot-comms.md. For now allow all for authenticated clients.
      return new Response("OK", { status: 200 });
    }

    if (url.pathname === "/health" || url.pathname === "/") {
      return new Response("ok", { status: 200 });
    }

    return new Response("Not Found", { status: 404 });
  },
});

console.log(`MQTT auth service listening on port ${server.port}`);
console.log(`IDENTITY_SERVICE_URL=${IDENTITY_SERVICE_URL}`);

/**
 * Privy device-authorization client (no app secret).
 * https://docs.privy.io/recipes/agent-integrations/agent-authorization
 */

import { getAddress } from "viem";
import { PRIVY_AUTH_BASE, resolvePrivyAppId } from "./privy-constants.mjs";
import {
  generateAuthorizationSignature,
  setupHpkeRecipient,
} from "./privy-hpke.mjs";
import {
  clearPrivySession,
  loadPrivySession,
  savePrivySession,
} from "./privy-session.mjs";

/**
 * @param {string} path
 * @param {{
 *   appId: string,
 *   method?: string,
 *   body?: object|null,
 *   accessToken?: string|null,
 *   grantType?: string|null,
 *   authorizationSignature?: string|null,
 *   fetchImpl?: typeof fetch,
 * }} opts
 */
export async function privyFetch(path, opts) {
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  if (!fetchImpl) throw new Error("fetch is not available");
  const method = opts.method ?? "POST";
  const headers = {
    "Content-Type": "application/json",
    "privy-app-id": opts.appId,
  };
  if (opts.accessToken) {
    headers.Authorization = `Bearer ${opts.accessToken}`;
  }
  if (opts.grantType) {
    headers["privy-grant-type"] = opts.grantType;
  }
  if (opts.authorizationSignature) {
    headers["privy-authorization-signature"] = opts.authorizationSignature;
  }
  const res = await fetchImpl(`${PRIVY_AUTH_BASE}${path}`, {
    method,
    headers,
    body: opts.body == null ? undefined : JSON.stringify(opts.body),
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  return { ok: res.ok, status: res.status, json, text };
}

/**
 * Start device authorization.
 * @param {{ appId?: string, fetchImpl?: typeof fetch }} [opts]
 */
export async function requestDeviceAuthorization(opts = {}) {
  const appId = opts.appId ?? resolvePrivyAppId();
  const { ok, status, json, text } = await privyFetch(
    "/api/oauth/v2/device_authorization",
    { appId, body: {}, fetchImpl: opts.fetchImpl },
  );
  if (!ok) {
    if (status === 403) {
      throw new Error(
        "Privy device auth is not enabled. In the Privy dashboard: Authentication → Advanced → Enable CLI and agent access, Verification URI = https://clanker-chain.com/authorize",
      );
    }
    throw new Error(
      `device_authorization failed (${status}): ${text?.slice(0, 300) || JSON.stringify(json)}`,
    );
  }
  return {
    appId,
    deviceCode: json.device_code,
    userCode: json.user_code,
    verificationUri: json.verification_uri,
    verificationUriComplete: json.verification_uri_complete,
    expiresIn: Number(json.expires_in) || 600,
    interval: Number(json.interval) || 5,
  };
}

/**
 * Poll until user approves (or deny / expire).
 * @param {{
 *   appId: string,
 *   deviceCode: string,
 *   interval?: number,
 *   expiresIn?: number,
 *   fetchImpl?: typeof fetch,
 *   sleep?: (ms: number) => Promise<void>,
 *   now?: () => number,
 *   onPending?: () => void,
 * }} opts
 */
export async function pollDeviceToken(opts) {
  const fetchImpl = opts.fetchImpl;
  const sleep =
    opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const now = opts.now ?? (() => Date.now());
  let intervalMs = Math.max(1, (opts.interval ?? 5) * 1000);
  const deadline = now() + (opts.expiresIn ?? 600) * 1000;

  while (now() < deadline) {
    await sleep(intervalMs);
    const { ok, status, json, text } = await privyFetch("/api/oauth/v2/token", {
      appId: opts.appId,
      body: {
        grant_type: "device_code",
        device_code: opts.deviceCode,
      },
      fetchImpl,
    });
    if (ok && json?.access_token) {
      return {
        accessToken: json.access_token,
        refreshToken: json.refresh_token,
        expiresIn: Number(json.expires_in) || 900,
      };
    }
    const err =
      json?.error ||
      json?.error_code ||
      (typeof json === "object" && json?.error?.code) ||
      "";
    const errStr = String(err);
    if (errStr === "authorization_pending" || status === 400) {
      if (errStr === "slow_down") {
        intervalMs += 5000;
      } else if (errStr === "expired_token") {
        throw new Error("Login timed out — run clanker login again");
      } else if (errStr === "access_denied") {
        throw new Error("Login denied in the browser");
      } else if (errStr && errStr !== "authorization_pending") {
        // Some responses nest error differently
        if (/expired/i.test(text || "")) {
          throw new Error("Login timed out — run clanker login again");
        }
        if (/access_denied|denied/i.test(text || "")) {
          throw new Error("Login denied in the browser");
        }
      }
      opts.onPending?.();
      continue;
    }
    throw new Error(
      `token poll failed (${status}): ${text?.slice(0, 300) || JSON.stringify(json)}`,
    );
  }
  throw new Error("Login timed out — run clanker login again");
}

/**
 * Refresh access token; persists rotated refresh token.
 * @param {{
 *   home?: string,
 *   session?: object,
 *   appId?: string,
 *   fetchImpl?: typeof fetch,
 * }} [opts]
 */
export async function refreshPrivySession(opts = {}) {
  const home = opts.home;
  const session = opts.session ?? loadPrivySession(home);
  if (!session?.refreshToken) {
    throw new Error("Not logged in — run clanker login");
  }
  const appId = opts.appId ?? session.appId ?? resolvePrivyAppId();
  const { ok, status, json, text } = await privyFetch("/api/oauth/v2/token", {
    appId,
    body: {
      grant_type: "refresh_token",
      refresh_token: session.refreshToken,
    },
    fetchImpl: opts.fetchImpl,
  });
  if (!ok || !json?.access_token) {
    clearPrivySession(home);
    throw new Error(
      `Session expired — run clanker login again (${status}): ${text?.slice(0, 200) || ""}`,
    );
  }
  const next = {
    ...session,
    appId,
    accessToken: json.access_token,
    refreshToken: json.refresh_token || session.refreshToken,
    expiresAt: Date.now() + (Number(json.expires_in) || 900) * 1000,
  };
  savePrivySession(next, home);
  return next;
}

/**
 * Exchange access token for ephemeral authorization key + wallet list.
 * Auth key stays in memory only.
 * @param {{
 *   appId: string,
 *   accessToken: string,
 *   fetchImpl?: typeof fetch,
 * }} opts
 */
export async function authenticateWallets(opts) {
  const hpke = await setupHpkeRecipient();
  const { ok, status, json, text } = await privyFetch(
    "/api/oauth/v2/wallets/authenticate",
    {
      appId: opts.appId,
      accessToken: opts.accessToken,
      grantType: "device_code",
      body: {
        encryption_type: "HPKE",
        recipient_public_key: hpke.publicKeySpkiBase64,
      },
      fetchImpl: opts.fetchImpl,
    },
  );
  if (!ok) {
    throw new Error(
      `wallets/authenticate failed (${status}): ${text?.slice(0, 300) || JSON.stringify(json)}`,
    );
  }
  const enc = json.encrypted_authorization_key;
  if (!enc?.encapsulated_key || !enc?.ciphertext) {
    throw new Error("wallets/authenticate missing encrypted_authorization_key");
  }
  const decrypted = await hpke.decryptPayload(
    Buffer.from(enc.encapsulated_key, "base64"),
    Buffer.from(enc.ciphertext, "base64"),
  );
  const authorizationPrivateKey = new TextDecoder().decode(decrypted);
  const wallets = Array.isArray(json.wallets) ? json.wallets : [];
  const eth =
    wallets.find((w) => w.chain_type === "ethereum" || w.chainType === "ethereum") ||
    wallets[0];
  if (!eth?.id || !eth?.address) {
    throw new Error(
      "No Ethereum wallet on this login — open /join once to create the embedded EOA, then clanker login again",
    );
  }
  return {
    authorizationPrivateKey,
    expiresAt: json.expires_at
      ? Date.parse(json.expires_at)
      : Date.now() + 14 * 60 * 1000,
    walletId: String(eth.id),
    address: getAddress(eth.address),
    wallets,
  };
}

/**
 * Ensure a valid session with access token (refresh if near expiry).
 * @param {{ home?: string, fetchImpl?: typeof fetch, skewMs?: number }} [opts]
 */
export async function ensurePrivyAccess(opts = {}) {
  const skewMs = opts.skewMs ?? 60_000;
  let session = loadPrivySession(opts.home);
  if (!session) {
    throw new Error("Not logged in — run clanker login");
  }
  if (!session.expiresAt || session.expiresAt < Date.now() + skewMs) {
    session = await refreshPrivySession({
      home: opts.home,
      session,
      fetchImpl: opts.fetchImpl,
    });
  }
  return session;
}

/**
 * Call Privy wallet RPC (personal_sign / eth_sendTransaction) with device grant.
 * @param {{
 *   method: string,
 *   params: object,
 *   home?: string,
 *   session?: object,
 *   fetchImpl?: typeof fetch,
 *   authCache?: { key: string, expiresAt: number, walletId: string, address: string }|null,
 * }} opts
 */
export async function privyWalletRpc(opts) {
  let session = opts.session ?? (await ensurePrivyAccess({ home: opts.home, fetchImpl: opts.fetchImpl }));
  const appId = session.appId ?? resolvePrivyAppId();

  const runOnce = async (sess) => {
    const auth = await authenticateWallets({
      appId,
      accessToken: sess.accessToken,
      fetchImpl: opts.fetchImpl,
    });
    if (
      sess.walletId &&
      auth.walletId !== sess.walletId
    ) {
      throw new Error(
        `Privy wallet changed (${auth.walletId} ≠ ${sess.walletId}) — run clanker login again`,
      );
    }
    if (
      sess.address &&
      getAddress(auth.address) !== getAddress(sess.address)
    ) {
      throw new Error(
        `Privy address ${auth.address} does not match session ${sess.address}`,
      );
    }
    const walletId = sess.walletId || auth.walletId;
    const url = `${PRIVY_AUTH_BASE}/api/oauth/v2/wallets/${walletId}/rpc`;
    const body = {
      method: opts.method,
      params: opts.params,
    };
    const authorizationSignature = generateAuthorizationSignature({
      authorizationPrivateKey: auth.authorizationPrivateKey,
      method: "POST",
      url,
      body,
      appId,
    });
    const { ok, status, json, text } = await privyFetch(
      `/api/oauth/v2/wallets/${walletId}/rpc`,
      {
        appId,
        accessToken: sess.accessToken,
        grantType: "device_code",
        authorizationSignature,
        body,
        fetchImpl: opts.fetchImpl,
      },
    );
    return { ok, status, json, text, auth };
  };

  let result = await runOnce(session);
  if (result.status === 401) {
    session = await refreshPrivySession({
      home: opts.home,
      session,
      fetchImpl: opts.fetchImpl,
    });
    result = await runOnce(session);
  }
  if (!result.ok) {
    throw new Error(
      `Privy wallet RPC ${opts.method} failed (${result.status}): ${result.text?.slice(0, 400) || JSON.stringify(result.json)}`,
    );
  }
  return {
    session,
    address: result.auth.address,
    walletId: result.auth.walletId,
    data: result.json?.data ?? result.json,
    json: result.json,
  };
}

/**
 * personal_sign via Privy.
 * @param {string} message
 * @param {{ home?: string, fetchImpl?: typeof fetch }} [opts]
 * @returns {Promise<`0x${string}`>}
 */
export async function privySignMessage(message, opts = {}) {
  const out = await privyWalletRpc({
    method: "personal_sign",
    params: { message, encoding: "utf-8" },
    home: opts.home,
    fetchImpl: opts.fetchImpl,
  });
  const sig =
    out.data?.signature ||
    out.data?.data?.signature ||
    out.json?.signature ||
    out.json?.data?.signature;
  if (!sig || typeof sig !== "string") {
    throw new Error(
      `Privy personal_sign returned no signature: ${JSON.stringify(out.json).slice(0, 400)}`,
    );
  }
  return /** @type {`0x${string}`} */ (sig.startsWith("0x") ? sig : `0x${sig}`);
}

/**
 * eth_sendTransaction via Privy (Privy broadcasts).
 * @param {object} transaction — viem-ish { to, data, value, chain_id }
 * @param {{ home?: string, fetchImpl?: typeof fetch }} [opts]
 * @returns {Promise<`0x${string}`>}
 */
export async function privySendTransaction(transaction, opts = {}) {
  const out = await privyWalletRpc({
    method: "eth_sendTransaction",
    params: { transaction },
    home: opts.home,
    fetchImpl: opts.fetchImpl,
  });
  const hash =
    out.data?.hash ||
    out.data?.data?.hash ||
    out.json?.hash ||
    out.json?.data?.hash;
  if (!hash || typeof hash !== "string") {
    throw new Error(
      `Privy eth_sendTransaction returned no hash: ${JSON.stringify(out.json).slice(0, 400)}`,
    );
  }
  return /** @type {`0x${string}`} */ (hash.startsWith("0x") ? hash : `0x${hash}`);
}

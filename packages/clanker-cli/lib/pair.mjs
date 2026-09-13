/**
 * Operator pairing client (Policy layer — docs/trust-model.md).
 * Signs with the operator owner key; never the bot key.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { loadOperator } from "./profile.mjs";
import { openclawConfigPath } from "./openclaw-wire.mjs";
import { resolveOperatorSigner } from "./operator-signer.mjs";

/**
 * @param {string} baseUrl
 * @param {{ operatorId: string, action: 'add'|'remove'|'list', peerLabel?: string }} opts
 */
export async function fetchPairNonce(baseUrl, opts) {
  const url = new URL("/pair-nonce", baseUrl.replace(/\/$/, ""));
  url.searchParams.set("operator_id", opts.operatorId);
  url.searchParams.set("action", opts.action);
  if (opts.peerLabel) url.searchParams.set("peer_label", opts.peerLabel);
  const res = await fetch(url.toString());
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`pair-nonce: unexpected response: ${text}`);
  }
  if (!res.ok || !body.nonce || !body.message) {
    throw new Error(body.error || `pair-nonce failed: HTTP ${res.status}`);
  }
  return /** @type {{ nonce: string, message: string, expires_at?: string }} */ (body);
}

/**
 * @param {string} baseUrl
 * @param {{
 *   operatorId: string,
 *   peerLabel: string,
 *   action: 'add'|'remove',
 *   nonce: string,
 *   signature: `0x${string}`,
 * }} opts
 */
export async function postPair(baseUrl, opts) {
  const res = await fetch(new URL("/pair", baseUrl.replace(/\/$/, "")).toString(), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      operator_id: opts.operatorId,
      peer_label: opts.peerLabel,
      action: opts.action,
      nonce: opts.nonce,
      signature: opts.signature,
    }),
  });
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`pair: unexpected response: ${text}`);
  }
  if (!res.ok) {
    throw new Error(body.error || `pair failed: HTTP ${res.status}`);
  }
  return body;
}

/**
 * @param {string} baseUrl
 * @param {{ operatorId: string, nonce: string, signature: `0x${string}` }} opts
 */
export async function getPairList(baseUrl, opts) {
  const url = new URL("/pair", baseUrl.replace(/\/$/, ""));
  url.searchParams.set("operator_id", opts.operatorId);
  url.searchParams.set("nonce", opts.nonce);
  url.searchParams.set("signature", opts.signature);
  const res = await fetch(url.toString());
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`pair list: unexpected response: ${text}`);
  }
  if (!res.ok) {
    throw new Error(body.error || `pair list failed: HTTP ${res.status}`);
  }
  return body;
}

/**
 * Merge allowOperators + dmPolicy into ~/.openclaw/openclaw.json channels.mqtt.
 * @param {{ peerLabel: string, action: 'add'|'remove', openclawHome?: string }} opts
 */
export function syncAllowOperators(opts) {
  const openclawHome = opts.openclawHome ?? join(homedir(), ".openclaw");
  const cfgPath = openclawConfigPath(openclawHome);
  if (!existsSync(cfgPath)) {
    return { synced: false, path: cfgPath, reason: "missing_openclaw_json" };
  }
  const cfg = JSON.parse(readFileSync(cfgPath, "utf8"));
  const channels = { ...(cfg.channels ?? {}) };
  const mqtt = { ...(channels.mqtt && typeof channels.mqtt === "object" ? channels.mqtt : {}) };
  const prev = Array.isArray(mqtt.allowOperators)
    ? mqtt.allowOperators.filter((x) => typeof x === "string")
    : [];
  let next;
  if (opts.action === "add") {
    next = prev.includes(opts.peerLabel) ? prev : [...prev, opts.peerLabel];
  } else {
    next = prev.filter((x) => x !== opts.peerLabel);
  }
  mqtt.allowOperators = next;
  if (!mqtt.dmPolicy) mqtt.dmPolicy = "pairing";
  channels.mqtt = mqtt;
  cfg.channels = channels;
  mkdirSync(openclawHome, { recursive: true });
  writeFileSync(cfgPath, `${JSON.stringify(cfg, null, 2)}\n`, "utf8");
  return { synced: true, path: cfgPath, allowOperators: next };
}

/**
 * Resolve mqtt-auth base URL from network / env / flag.
 * @param {string[]} argv
 * @param {{ mqttAuthServiceUrl?: string|null }} network
 */
export function resolvePairAuthUrl(argv, network) {
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--auth-url" && argv[i + 1]) return argv[i + 1];
  }
  if (process.env.MQTT_AUTH_SERVICE_URL) return process.env.MQTT_AUTH_SERVICE_URL;
  if (network.mqttAuthServiceUrl) return network.mqttAuthServiceUrl;
  throw new Error(
    "mqttAuthServiceUrl required for pairing. Set profile via clanker setup, " +
      "pass --auth-url, or set MQTT_AUTH_SERVICE_URL.",
  );
}

/**
 * Optional OpenClaw home for allowOperators sync (directory containing openclaw.json).
 * @param {string[]} argv
 * @returns {string|undefined}
 */
export function resolveOpenclawHome(argv) {
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--openclaw-home" && argv[i + 1]) return argv[i + 1];
  }
  if (process.env.OPENCLAW_HOME) return process.env.OPENCLAW_HOME;
  return undefined;
}

/**
 * @param {string[]} argv
 * @param {'add'|'remove'|'list'|'status'} action
 * @param {string|null} peerLabel
 */
export async function runPairAction(argv, action, peerLabel) {
  const signer = await resolveOperatorSigner(argv, { requireRegistry: true });
  const operator =
    loadOperator(signer.network.home) ??
    (signer.network.operatorLabel
      ? { label: signer.network.operatorLabel }
      : null);
  const operatorId =
    argv.includes("--operator") && argv[argv.indexOf("--operator") + 1]
      ? argv[argv.indexOf("--operator") + 1]
      : operator?.label;
  if (!operatorId) {
    throw new Error(
      "Operator label required. Run clanker setup / write operator.json, or pass --operator org.you.",
    );
  }

  const authUrl = resolvePairAuthUrl(argv, signer.network);

  if (action === "list" || action === "status") {
    const { nonce, message } = await fetchPairNonce(authUrl, {
      operatorId,
      action: "list",
    });
    const signature = await signer.signMessage({ message });
    const listed = await getPairList(authUrl, {
      operatorId,
      nonce,
      signature,
    });
    if (action === "status") {
      if (!peerLabel) throw new Error("Usage: clanker pair status <operator-label>");
      const { keccak256, toBytes } = await import("viem");
      const peerId = keccak256(toBytes(peerLabel)).toLowerCase();
      const hit = (listed.allows ?? []).find(
        (a) => String(a.peer_operator_id).toLowerCase() === peerId,
      );
      return {
        action: "status",
        operatorId,
        peerLabel,
        allowed: Boolean(hit),
        mutual: hit?.mutual === true,
        authUrl,
        listed,
      };
    }
    return { action: "list", operatorId, authUrl, listed };
  }

  if (!peerLabel) {
    throw new Error(`Usage: clanker pair ${action} <operator-label>`);
  }

  const { nonce, message } = await fetchPairNonce(authUrl, {
    operatorId,
    action,
    peerLabel,
  });
  const signature = await signer.signMessage({ message });
  const result = await postPair(authUrl, {
    operatorId,
    peerLabel,
    action,
    nonce,
    signature,
  });
  const sync = syncAllowOperators({
    peerLabel,
    action,
    openclawHome: resolveOpenclawHome(argv),
  });
  return {
    action,
    operatorId,
    peerLabel,
    authUrl,
    result,
    openclawSync: sync,
  };
}

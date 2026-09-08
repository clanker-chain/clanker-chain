/**
 * Local operator profile under ~/.clanker (or CLANKER_HOME).
 * Never stores raw private keys — only key pointers.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** Anvil account #0 — local-dev only. */
export const ANVIL_DEFAULT_PRIVATE_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

export const ANVIL_DEFAULT_ADDRESS = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";

/** Closed-beta Base Sepolia registry (see docs/public-testnet-hub.md). */
export const SEPOLIA_REGISTRY = "0xD650467f9D7A20f37E55ec23Ca1c711598f97958";

/**
 * Safe floor for Sepolia getLogs (before registry deploy). Documented so scans
 * stay cheap; bump only if you redeploy the registry earlier.
 */
export const SEPOLIA_FROM_BLOCK = 35_000_000n;

export const PRESETS = {
  local: {
    preset: "local",
    registryAddress: null,
    chainRpcUrl: "http://127.0.0.1:8545",
    brokerUrl: "mqtt://localhost:1883",
    mqttAuthServiceUrl: "http://localhost:9090",
    fromBlock: 0n,
  },
  sepolia: {
    preset: "sepolia",
    registryAddress: SEPOLIA_REGISTRY,
    chainRpcUrl: "https://sepolia.base.org",
    brokerUrl: "mqtts://mqtt.clanker-chain.com:8883",
    mqttAuthServiceUrl: "https://mqtt-auth.clanker-chain.com",
    fromBlock: SEPOLIA_FROM_BLOCK,
  },
};

export function clankerHome(env = process.env) {
  return env.CLANKER_HOME ?? join(homedir(), ".clanker");
}

export function configPath(home = clankerHome()) {
  return join(home, "config.json");
}

export function operatorPath(home = clankerHome()) {
  return join(home, "operator.json");
}

export function clankerKeysDir(env = process.env, home = clankerHome(env)) {
  return env.CLANKER_KEY_DIR ?? join(home, "keys");
}

export function openclawKeysDir() {
  return join(homedir(), ".openclaw", "keys");
}

/**
 * @param {string} presetName
 * @param {{ force?: boolean, registryAddress?: string|null, home?: string }} [opts]
 */
export function initProfile(presetName, opts = {}) {
  const name = String(presetName || "").toLowerCase();
  if (!PRESETS[name]) {
    throw new Error(`Unknown preset "${presetName}". Use "local" or "sepolia".`);
  }
  const home = opts.home ?? clankerHome();
  const path = configPath(home);
  if (existsSync(path) && !opts.force) {
    throw new Error(
      `Profile already exists at ${path}. Pass --force to overwrite, or edit the file.`,
    );
  }
  mkdirSync(home, { recursive: true });
  const preset = PRESETS[name];
  const config = {
    preset: preset.preset,
    registryAddress: opts.registryAddress ?? preset.registryAddress,
    chainRpcUrl: preset.chainRpcUrl,
    brokerUrl: preset.brokerUrl,
    mqttAuthServiceUrl: preset.mqttAuthServiceUrl,
    fromBlock: preset.fromBlock.toString(),
  };
  if (name === "local" && !config.registryAddress) {
    // Placeholder until chain deploy; operator must set after forge deploy.
    config.registryAddress = null;
  }
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  return { path, config };
}

/**
 * @param {string} [home]
 * @returns {object|null}
 */
export function loadConfig(home = clankerHome()) {
  const path = configPath(home);
  if (!existsSync(path)) return null;
  const raw = JSON.parse(readFileSync(path, "utf8"));
  if (raw.fromBlock != null && typeof raw.fromBlock !== "bigint") {
    raw.fromBlock = BigInt(raw.fromBlock);
  }
  return raw;
}

/**
 * @param {string} [home]
 * @returns {object|null}
 */
export function loadOperator(home = clankerHome()) {
  const path = operatorPath(home);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8"));
}

/**
 * Write operator profile (label + owner + key pointer). Never stores hex keys.
 * @param {{ label: string, owner: string, key?: { type: 'env'|'keyFile', value?: string } }} op
 * @param {string} [home]
 */
export function writeOperator(op, home = clankerHome()) {
  mkdirSync(home, { recursive: true });
  const path = operatorPath(home);
  const out = {
    label: op.label,
    owner: op.owner,
    key: op.key ?? { type: "env", value: "OPERATOR_PRIVATE_KEY" },
  };
  writeFileSync(path, `${JSON.stringify(out, null, 2)}\n`, { mode: 0o600 });
  return { path, operator: out };
}

/**
 * Merge profile + env + argv overrides into a network view (no key yet).
 * Precedence: argv flags > env > profile > preset defaults for local RPC.
 *
 * @param {string[]} argv
 * @param {{ home?: string, env?: NodeJS.ProcessEnv }} [opts]
 */
export function resolveNetwork(argv = [], opts = {}) {
  const env = opts.env ?? process.env;
  const home = opts.home ?? clankerHome(env);
  const config = loadConfig(home);

  let rpc = env.CHAIN_RPC_URL ?? env.BASE_SEPOLIA_RPC_URL ?? null;
  let registry = env.REGISTRY_ADDRESS ?? null;
  let fromBlock = null;
  let brokerUrl = null;
  let mqttAuthServiceUrl = null;
  let preset = null;
  let keyFile = null;
  let json = false;
  let operatorLabel = null;

  if (config) {
    preset = config.preset ?? null;
    rpc = rpc ?? config.chainRpcUrl ?? null;
    registry = registry ?? config.registryAddress ?? null;
    fromBlock = config.fromBlock != null ? BigInt(config.fromBlock) : null;
    brokerUrl = config.brokerUrl ?? null;
    mqttAuthServiceUrl = config.mqttAuthServiceUrl ?? null;
  }

  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--rpc" && argv[i + 1]) rpc = argv[++i];
    else if (a === "--registry" && argv[i + 1]) registry = argv[++i];
    else if (a === "--key-file" && argv[i + 1]) keyFile = argv[++i];
    else if (a === "--operator" && argv[i + 1]) operatorLabel = argv[++i];
    else if (a === "--from-block" && argv[i + 1]) fromBlock = BigInt(argv[++i]);
    else if (a === "--json") json = true;
  }

  if (!rpc) {
    rpc = "http://127.0.0.1:8545";
  }

  if (fromBlock == null) {
    fromBlock = isLocalRpc(rpc) ? 0n : SEPOLIA_FROM_BLOCK;
  }

  return {
    rpc,
    registry,
    fromBlock,
    brokerUrl,
    mqttAuthServiceUrl,
    preset,
    keyFile,
    json,
    operatorLabel,
    config,
    home,
  };
}

export function isLocalRpc(rpc) {
  if (!rpc) return false;
  try {
    const u = new URL(rpc);
    const host = u.hostname.toLowerCase();
    return host === "127.0.0.1" || host === "localhost" || host === "::1";
  } catch {
    return /127\.0\.0\.1|localhost/.test(rpc);
  }
}

/**
 * Harness snippet for OpenClaw channels.mqtt from network + ids.
 */
export function harnessSnippet({ botId, operatorId, network }) {
  return {
    enabled: true,
    botId,
    operatorId,
    brokerUrl: network.brokerUrl ?? "mqtt://localhost:1883",
    chainRpcUrl: network.rpc,
    registryAddress: network.registry,
    mqttAuthServiceUrl: network.mqttAuthServiceUrl ?? "http://localhost:9090",
  };
}

/**
 * Local identity hints for `clanker setup` (no secrets printed).
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { spawnSync } from "node:child_process";
import { privateKeyToAccount } from "viem/accounts";
import {
  ANVIL_DEFAULT_ADDRESS,
  clankerHome,
  loadConfig,
  loadOperator,
  openclawKeysDir,
} from "./profile.mjs";
import { normalizePrivateKey } from "./resolve.mjs";

/** Faster Sepolia log floor for public RPC (registry floor remains SEPOLIA_FROM_BLOCK). */
export const SEPOLIA_FAST_FROM_BLOCK = 46_000_000n;

/**
 * Parse `cast wallet list` stdout into account names.
 * @param {string} stdout
 * @returns {string[]}
 */
export function parseCastWalletList(stdout) {
  const names = [];
  for (const line of String(stdout ?? "").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    // Formats: "name (Local)" or "0xname (Local)" or just "name"
    const m = trimmed.match(/^(\S+)/);
    if (!m) continue;
    let name = m[1];
    if (name.startsWith("0x") && name.length > 2 && !/^0x[a-fA-F0-9]{40}$/.test(name)) {
      // cast sometimes prefixes 0x to the account name display
      name = name.slice(2);
    }
    if (/^0x[a-fA-F0-9]{40}$/.test(name)) continue;
    names.push(name);
  }
  return [...new Set(names)];
}

/**
 * @param {{ castBin?: string, spawn?: typeof spawnSync }} [opts]
 * @returns {{ available: boolean, accounts: string[] }}
 */
export function listFoundryAccounts(opts = {}) {
  const spawn = opts.spawn ?? spawnSync;
  const castBin = opts.castBin ?? "cast";
  const result = spawn(castBin, ["wallet", "list"], {
    encoding: "utf8",
    shell: false,
  });
  if (result.error || result.status !== 0) {
    return { available: false, accounts: [] };
  }
  return { available: true, accounts: parseCastWalletList(result.stdout ?? "") };
}

/**
 * Bot key basenames under ~/.openclaw/keys (context only).
 * @param {{ openclawDir?: string }} [opts]
 * @returns {string[]}
 */
export function listOpenclawBotKeys(opts = {}) {
  const dir = opts.openclawDir ?? openclawKeysDir();
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".key"))
    .map((f) => basename(f, ".key"))
    .sort();
}

/**
 * Derive address from a key file (first line). Does not log the key.
 * @param {string} path
 * @returns {string}
 */
export function addressFromKeyFile(path) {
  if (!existsSync(path)) throw new Error(`Key file not found: ${path}`);
  const key = normalizePrivateKey(readFileSync(path, "utf8").split(/\r?\n/)[0]);
  return privateKeyToAccount(key).address;
}

/**
 * Derive address from OPERATOR_PRIVATE_KEY (or named env).
 * @param {NodeJS.ProcessEnv} [env]
 * @param {string} [envName]
 * @returns {string|null}
 */
export function addressFromEnv(env = process.env, envName = "OPERATOR_PRIVATE_KEY") {
  const raw = env[envName];
  if (!raw) return null;
  const key = normalizePrivateKey(raw);
  return privateKeyToAccount(key).address;
}

/**
 * Snapshot of local hints for setup UX.
 * @param {{ home?: string, env?: NodeJS.ProcessEnv, openclawDir?: string, castBin?: string, spawn?: typeof spawnSync }} [opts]
 */
export function detectSetupHints(opts = {}) {
  const env = opts.env ?? process.env;
  const home = opts.home ?? clankerHome(env);
  const config = loadConfig(home);
  const operator = loadOperator(home);
  const foundry = listFoundryAccounts({
    castBin: opts.castBin,
    spawn: opts.spawn,
  });
  const openclawBots = listOpenclawBotKeys({ openclawDir: opts.openclawDir });
  let envAddress = null;
  try {
    envAddress = addressFromEnv(env);
  } catch {
    envAddress = null;
  }

  return {
    home,
    configPath: join(home, "config.json"),
    operatorPath: join(home, "operator.json"),
    hasConfig: Boolean(config),
    hasOperator: Boolean(operator),
    config,
    operator,
    hasOperatorPrivateKeyEnv: Boolean(env.OPERATOR_PRIVATE_KEY),
    envAddress,
    foundryAvailable: foundry.available,
    foundryAccounts: foundry.accounts,
    openclawBots,
    anvilDefaultAddress: ANVIL_DEFAULT_ADDRESS,
  };
}

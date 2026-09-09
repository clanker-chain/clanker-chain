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
  SEPOLIA_FAST_FROM_BLOCK,
} from "./profile.mjs";
import { normalizePrivateKey } from "./resolve.mjs";

export { SEPOLIA_FAST_FROM_BLOCK };

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

/**
 * Pad string to width (truncate with … if longer).
 * @param {string} s
 * @param {number} width
 */
function cell(s, width) {
  const t = String(s ?? "");
  if (t.length === width) return t;
  if (t.length < width) return t + " ".repeat(width - t.length);
  if (width <= 1) return "…";
  return `${t.slice(0, width - 1)}…`;
}

/**
 * Render detection hints as an aligned two-column table for the terminal.
 * @param {ReturnType<typeof detectSetupHints>} hints
 * @returns {string}
 */
export function formatSetupDetectTable(hints) {
  /** @type {[string, string][]} */
  const rows = [];
  rows.push(["Profile dir", hints.home]);

  if (hints.hasConfig) {
    rows.push(["config.json", `present · preset=${hints.config?.preset ?? "?"}`]);
    rows.push([
      "registry",
      hints.config?.registryAddress ? String(hints.config.registryAddress) : "(none)",
    ]);
  } else {
    rows.push(["config.json", "missing · will create"]);
  }

  if (hints.hasOperator) {
    rows.push([
      "operator.json",
      `present · ${hints.operator?.label ?? "?"} · ${hints.operator?.owner ?? "?"}`,
    ]);
  } else {
    rows.push(["operator.json", "missing · needed for whoami"]);
  }

  if (hints.foundryAvailable && hints.foundryAccounts.length) {
    rows.push([
      "Foundry accounts",
      `${hints.foundryAccounts.length}: ${hints.foundryAccounts.join(", ")}`,
    ]);
  } else if (hints.foundryAvailable) {
    rows.push(["Foundry accounts", "none listed"]);
  } else {
    rows.push(["Foundry cast", "not on PATH"]);
  }

  if (hints.openclawBots.length) {
    rows.push([
      "OpenClaw bot keys",
      `${hints.openclawBots.length} files (bot signing only)`,
    ]);
    for (const b of hints.openclawBots) {
      rows.push(["  ·", b]);
    }
  } else {
    rows.push(["OpenClaw bot keys", "none"]);
  }

  if (hints.hasOperatorPrivateKeyEnv) {
    rows.push([
      "OPERATOR_PRIVATE_KEY",
      hints.envAddress ? `set · ${hints.envAddress}` : "set · (invalid)",
    ]);
  } else {
    rows.push(["OPERATOR_PRIVATE_KEY", "unset"]);
  }

  const col0 = Math.min(
    22,
    Math.max(4, ...rows.map(([k]) => k.length)),
  );
  const lines = [
    `${cell("What", col0)}  Value`,
    `${"-".repeat(col0)}  ${"-".repeat(48)}`,
  ];
  for (const [k, v] of rows) {
    lines.push(`${cell(k, col0)}  ${v}`);
  }
  return lines.join("\n");
}

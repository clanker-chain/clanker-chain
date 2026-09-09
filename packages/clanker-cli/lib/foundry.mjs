/**
 * Foundry cast helpers for setup (address resolve + key export).
 * Never logs private keys.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { spawnSync } from "node:child_process";
import { getAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { normalizePrivateKey } from "./resolve.mjs";
import { parseCastWalletList } from "./setup-detect.mjs";

/**
 * @param {{ castBin?: string, spawn?: typeof spawnSync }} [opts]
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
 * Resolve 0x address for a Foundry account name.
 * Uses inherit stdio so unlock prompts work when interactive.
 *
 * @param {string} account
 * @param {{ castBin?: string, spawn?: typeof spawnSync, inheritStdio?: boolean }} [opts]
 * @returns {string} checksummed address
 */
export function resolveFoundryAddress(account, opts = {}) {
  const spawn = opts.spawn ?? spawnSync;
  const castBin = opts.castBin ?? "cast";
  const inherit = opts.inheritStdio !== false;
  const result = spawn(castBin, ["wallet", "address", account], {
    encoding: "utf8",
    shell: false,
    stdio: inherit ? ["inherit", "pipe", "inherit"] : "pipe",
  });
  if (result.error) {
    throw new Error(`cast failed: ${result.error.message}`);
  }
  if (result.status !== 0) {
    const err = (result.stderr || result.stdout || "").trim();
    throw new Error(
      err || `cast wallet address ${account} failed (status ${result.status})`,
    );
  }
  const line = String(result.stdout ?? "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => /^0x[0-9a-fA-F]{40}$/.test(l));
  if (!line) {
    throw new Error(`Could not parse address from cast wallet address ${account}`);
  }
  return getAddress(line);
}

/**
 * Export Foundry account private key to destPath (mode 0o600).
 * Does not print the key. Unlock prompts via inherit stdio when interactive.
 *
 * @param {string} account
 * @param {string} destPath
 * @param {{ castBin?: string, spawn?: typeof spawnSync, inheritStdio?: boolean }} [opts]
 * @returns {{ path: string, address: string }}
 */
export function exportFoundryKey(account, destPath, opts = {}) {
  const spawn = opts.spawn ?? spawnSync;
  const castBin = opts.castBin ?? "cast";
  const inherit = opts.inheritStdio !== false;
  const result = spawn(castBin, ["wallet", "private-key", account], {
    encoding: "utf8",
    shell: false,
    stdio: inherit ? ["inherit", "pipe", "inherit"] : "pipe",
  });
  if (result.error) {
    throw new Error(`cast failed: ${result.error.message}`);
  }
  if (result.status !== 0) {
    const err = (result.stderr || "").trim();
    throw new Error(
      err || `cast wallet private-key ${account} failed (status ${result.status})`,
    );
  }
  const raw = String(result.stdout ?? "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  if (!raw) {
    throw new Error("cast returned empty private key");
  }
  const key = normalizePrivateKey(raw);
  const address = privateKeyToAccount(key).address;

  mkdirSync(dirname(destPath), { recursive: true });
  writeFileSync(destPath, `${key}\n`, { mode: 0o600 });
  return { path: destPath, address };
}

/**
 * Default operator key path under clanker home.
 * @param {string} home
 */
export function defaultOperatorKeyPath(home) {
  return `${home.replace(/\/$/, "")}/op.key`;
}

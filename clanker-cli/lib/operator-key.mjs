/**
 * Consumer-path operator key helpers (generate local op.key).
 * Never logs private keys.
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { defaultOperatorKeyPath } from "./foundry.mjs";

export { defaultOperatorKeyPath };

/** Coinbase Developer Platform faucet UI (Base Sepolia). */
export const BASE_SEPOLIA_FAUCET_URL =
  "https://portal.cdp.coinbase.com/products/faucet";

/**
 * Generate a new secp256k1 key and write it to destPath (mode 0o600).
 * Does not print the key.
 *
 * @param {string} destPath
 * @param {{ force?: boolean }} [opts]
 * @returns {{ path: string, address: string }}
 */
export function generateOperatorKeyFile(destPath, opts = {}) {
  if (existsSync(destPath) && !opts.force) {
    throw new Error(
      `Key file already exists: ${destPath} (pass --force to overwrite)`,
    );
  }
  const key = generatePrivateKey();
  const address = privateKeyToAccount(key).address;
  mkdirSync(dirname(destPath), { recursive: true });
  writeFileSync(destPath, `${key}\n`, { mode: 0o600 });
  return { path: destPath, address };
}

/**
 * Plain-language next steps after creating an operator key on Sepolia.
 * @param {{ address: string, label?: string }} opts
 */
export function consumerFundHints(opts) {
  const mintLabel = opts.label ? ` ${opts.label}` : "";
  return [
    `Your operator address is ${opts.address} — fund it with Base Sepolia ETH: ${BASE_SEPOLIA_FAUCET_URL}`,
    "clanker doctor",
    `clanker operator mint${mintLabel} --yes`,
    "clanker bot mint <bot_label> --yes",
  ];
}

/**
 * Consumer-path operator key helpers (generate local op.key).
 * Never logs private keys.
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { defaultOperatorKeyPath } from "./foundry.mjs";

export { defaultOperatorKeyPath };

/** Coinbase Developer Platform portal (Faucets live in-nav; deep link /products/faucet 404s). */
export const BASE_SEPOLIA_FAUCET_URL = "https://portal.cdp.coinbase.com/";

/** Backup Base Sepolia faucet (amounts not guaranteed). */
export const ALCHEMY_BASE_SEPOLIA_FAUCET_URL =
  "https://www.alchemy.com/faucets/base-sepolia";

/** Documented CDP ETH drip per claim on Base Sepolia. */
export const CDP_FAUCET_DRIP_ETH = "0.0001";

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
    `Your operator address is ${opts.address} — fund it with Base Sepolia ETH`,
    "clanker fund",
    "clanker doctor",
    `clanker operator mint${mintLabel} --yes`,
    "clanker bot mint <bot_label> --yes",
  ];
}

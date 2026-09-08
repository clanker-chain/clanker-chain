/**
 * Operator key resolution + Anvil guard for non-local RPCs.
 */

import { existsSync, readFileSync } from "node:fs";
import { privateKeyToAccount } from "viem/accounts";
import {
  ANVIL_DEFAULT_PRIVATE_KEY,
  isLocalRpc,
  loadOperator,
  resolveNetwork,
} from "./profile.mjs";

/**
 * Normalize a hex private key (with or without 0x).
 * @param {string} raw
 * @returns {`0x${string}`}
 */
export function normalizePrivateKey(raw) {
  const s = String(raw ?? "").trim();
  if (!s) throw new Error("Empty private key");
  const hex = s.startsWith("0x") ? s : `0x${s}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error("Private key must be 0x + 64 hex characters");
  }
  return /** @type {`0x${string}`} */ (hex.toLowerCase());
}

export function isAnvilDefaultKey(key) {
  try {
    return normalizePrivateKey(key) === ANVIL_DEFAULT_PRIVATE_KEY.toLowerCase();
  } catch {
    return false;
  }
}

/**
 * Parse --key / --key-file from argv (does not apply Anvil default).
 * @param {string[]} argv
 * @returns {{ key: string|null, keyFile: string|null, usedExplicitKey: boolean }}
 */
export function parseKeyFlags(argv) {
  let key = null;
  let keyFile = null;
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--key" && argv[i + 1]) {
      key = argv[++i];
    } else if (a === "--key-file" && argv[i + 1]) {
      keyFile = argv[++i];
    }
  }
  return { key, keyFile, usedExplicitKey: Boolean(key || keyFile) };
}

/**
 * Map how the key was resolved into a durable operator.json pointer.
 * Raw `--key` cannot be re-read later; persist env so the next command expects OPERATOR_PRIVATE_KEY.
 *
 * @param {{ source: string, keyFilePath?: string|null }} opts
 * @returns {{ type: 'env'|'keyFile', value: string }}
 */
export function keyPointerFromSource(opts) {
  const source = opts.source ?? "";
  if (source.startsWith("--key-file ")) {
    return { type: "keyFile", value: source.slice("--key-file ".length) };
  }
  if (source.startsWith("profile keyFile ")) {
    return { type: "keyFile", value: source.slice("profile keyFile ".length) };
  }
  if (opts.keyFilePath) {
    return { type: "keyFile", value: opts.keyFilePath };
  }
  if (source.startsWith("profile env ")) {
    return { type: "env", value: source.slice("profile env ".length) };
  }
  return { type: "env", value: "OPERATOR_PRIVATE_KEY" };
}

/**
 * Resolve the operator signing key with Anvil guard.
 *
 * Precedence: --key > --key-file > OPERATOR_PRIVATE_KEY > profile keyFile > profile env > Anvil (local only).
 *
 * @param {string[]} argv
 * @param {{ home?: string, env?: NodeJS.ProcessEnv, rpc?: string, requireRegistry?: boolean }} [opts]
 * @returns {{ key: `0x${string}`, address: string, source: string, keyPointer: { type: string, value: string }, network: object }}
 */
export function resolveOperatorKey(argv = [], opts = {}) {
  const env = opts.env ?? process.env;
  const network = resolveNetwork(argv, { home: opts.home, env });
  const rpc = opts.rpc ?? network.rpc;
  const flags = parseKeyFlags(argv);
  const operator = loadOperator(opts.home ?? network.home);
  const requireRegistry = opts.requireRegistry !== false;

  let key = null;
  let source = null;
  let keyFilePath = null;

  if (flags.key) {
    key = normalizePrivateKey(flags.key);
    source = "--key";
  } else if (flags.keyFile || network.keyFile) {
    const path = flags.keyFile || network.keyFile;
    if (!existsSync(path)) {
      throw new Error(`Key file not found: ${path}`);
    }
    key = normalizePrivateKey(readFileSync(path, "utf8").split(/\r?\n/)[0]);
    keyFilePath = path;
    source = `--key-file ${path}`;
  } else if (env.OPERATOR_PRIVATE_KEY) {
    key = normalizePrivateKey(env.OPERATOR_PRIVATE_KEY);
    source = "OPERATOR_PRIVATE_KEY";
  } else if (operator?.key?.type === "keyFile" && operator.key.value) {
    const path = operator.key.value;
    if (!existsSync(path)) {
      throw new Error(`Profile keyFile not found: ${path}`);
    }
    key = normalizePrivateKey(readFileSync(path, "utf8").split(/\r?\n/)[0]);
    keyFilePath = path;
    source = `profile keyFile ${path}`;
  } else if (operator?.key?.type === "env" && operator.key.value && env[operator.key.value]) {
    key = normalizePrivateKey(env[operator.key.value]);
    source = `profile env ${operator.key.value}`;
  }

  const local = isLocalRpc(rpc);

  if (!key) {
    if (local) {
      key = normalizePrivateKey(ANVIL_DEFAULT_PRIVATE_KEY);
      source = "anvil-default (local RPC)";
    } else {
      throw new Error(
        "Operator private key required for non-local RPC. Set OPERATOR_PRIVATE_KEY, " +
          "pass --key / --key-file, or configure ~/.clanker/operator.json key pointer. " +
          "Anvil account #0 is not used on public networks.",
      );
    }
  }

  if (!local && isAnvilDefaultKey(key)) {
    throw new Error(
      "Refusing Anvil account #0 key on a non-local RPC. " +
        "Use a real OPERATOR_PRIVATE_KEY / --key for Sepolia (or any public chain).",
    );
  }

  if (requireRegistry && (!network.registry || !/^0x[0-9a-fA-F]{40}$/.test(network.registry))) {
    throw new Error(
      "REGISTRY_ADDRESS or --registry is required (0x + 40 hex). " +
        "Run `clanker init --preset sepolia` or set registry after `clanker chain deploy`.",
    );
  }

  const account = privateKeyToAccount(key);
  const keyPointer = keyPointerFromSource({ source, keyFilePath });
  return {
    key,
    address: account.address,
    source,
    keyPointer,
    network: { ...network, rpc },
  };
}

/**
 * Like resolveOperatorKey but for read-only commands that may not need a key
 * (e.g. whoami can use --address). Still resolves network.
 */
export function resolveForRead(argv = [], opts = {}) {
  const network = resolveNetwork(argv, opts);
  if (!network.registry || !/^0x[0-9a-fA-F]{40}$/.test(network.registry)) {
    throw new Error(
      "REGISTRY_ADDRESS or --registry is required (0x + 40 hex). " +
        "Run `clanker init --preset sepolia` or set registry after `clanker chain deploy`.",
    );
  }
  return network;
}

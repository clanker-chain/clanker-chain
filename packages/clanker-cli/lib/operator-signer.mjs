/**
 * Pluggable operator signer: local hex key or Privy device-grant vault.
 */

import {
  createPublicClient,
  createWalletClient,
  defineChain,
  encodeFunctionData,
  getAddress,
  http,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  isAnvilDefaultKey,
  OWNER_SIGNER_REQUIRED,
  parseKeyFlags,
  resolveOperatorKey,
} from "./resolve.mjs";
import {
  ANVIL_DEFAULT_PRIVATE_KEY,
  isLocalRpc,
  loadOperator,
  resolveNetwork,
} from "./profile.mjs";
import { loadPrivySession } from "./privy-session.mjs";
import { privySendTransaction, privySignMessage } from "./privy-client.mjs";
import { existsSync, readFileSync } from "node:fs";
import { normalizePrivateKey } from "./resolve.mjs";

export { OWNER_SIGNER_REQUIRED };

/**
 * @typedef {{
 *   address: `0x${string}`,
 *   source: string,
 *   keyPointer: { type: string, value: string }|null,
 *   network: object,
 *   kind: 'local'|'privy',
 *   key?: `0x${string}`,
 *   signMessage: (args: { message: string }) => Promise<`0x${string}`>,
 *   writeContract: (args: object) => Promise<`0x${string}`>,
 *   publicClient: import('viem').PublicClient,
 * }} OperatorSigner
 */

async function chainFromRpc(rpc) {
  const publicClient = createPublicClient({ transport: http(rpc) });
  const id = await publicClient.getChainId();
  return defineChain({
    id,
    name: `clanker-chain-${id}`,
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [rpc] } },
  });
}

/**
 * @param {string} rpc
 * @param {`0x${string}`} key
 */
async function localSignerFromKey(rpc, key, meta) {
  const account = privateKeyToAccount(key);
  const transport = http(rpc);
  const chain = await chainFromRpc(rpc);
  const publicClient = createPublicClient({ chain, transport });
  const wallet = createWalletClient({ account, chain, transport });
  return {
    ...meta,
    kind: "local",
    key,
    address: account.address,
    publicClient,
    signMessage: async ({ message }) => account.signMessage({ message }),
    writeContract: async (args) => wallet.writeContract(args),
  };
}

/**
 * @param {string} rpc
 * @param {{ address: string, walletId: string, home?: string, fetchImpl?: typeof fetch }} privy
 * @param {object} meta
 */
async function privySignerFromSession(rpc, privy, meta) {
  const transport = http(rpc);
  const chain = await chainFromRpc(rpc);
  const publicClient = createPublicClient({ chain, transport });
  const address = getAddress(privy.address);

  return {
    ...meta,
    kind: "privy",
    address,
    publicClient,
    signMessage: async ({ message }) =>
      privySignMessage(message, {
        home: privy.home,
        fetchImpl: privy.fetchImpl,
      }),
    writeContract: async (args) => {
      const data = encodeFunctionData({
        abi: args.abi,
        functionName: args.functionName,
        args: args.args,
      });
      const value =
        args.value == null
          ? undefined
          : typeof args.value === "bigint"
            ? `0x${args.value.toString(16)}`
            : args.value;
      const chainId = chain.id;
      return privySendTransaction(
        {
          to: args.address,
          data,
          value,
          chain_id: chainId,
        },
        { home: privy.home, fetchImpl: privy.fetchImpl },
      );
    },
  };
}

/**
 * Resolve an operator signer (local key or Privy session).
 *
 * Precedence for local: --key > --key-file > OPERATOR_PRIVATE_KEY > profile keyFile/env.
 * Else if profile key.type === privy or a Privy session exists → Privy vault.
 * Else Anvil on local RPC only.
 *
 * @param {string[]} argv
 * @param {{
 *   home?: string,
 *   env?: NodeJS.ProcessEnv,
 *   rpc?: string,
 *   requireRegistry?: boolean,
 *   fetchImpl?: typeof fetch,
 * }} [opts]
 * @returns {Promise<OperatorSigner>}
 */
export async function resolveOperatorSigner(argv = [], opts = {}) {
  const env = opts.env ?? process.env;
  const network = resolveNetwork(argv, { home: opts.home, env });
  const rpc = opts.rpc ?? network.rpc;
  const home = opts.home ?? network.home;
  const operator = loadOperator(home);
  const requireRegistry = opts.requireRegistry !== false;
  const flags = parseKeyFlags(argv);
  const local = isLocalRpc(rpc);

  if (requireRegistry && (!network.registry || !/^0x[0-9a-fA-F]{40}$/.test(network.registry))) {
    throw new Error(
      "REGISTRY_ADDRESS or --registry is required (0x + 40 hex). " +
        "Run `clanker init --preset sepolia` or set registry after `clanker chain deploy`.",
    );
  }

  // Explicit local key paths first.
  let key = null;
  let source = null;
  let keyFilePath = null;
  if (flags.key) {
    key = normalizePrivateKey(flags.key);
    source = "--key";
  } else if (flags.keyFile || network.keyFile) {
    const path = flags.keyFile || network.keyFile;
    if (!existsSync(path)) throw new Error(`Key file not found: ${path}`);
    key = normalizePrivateKey(readFileSync(path, "utf8").split(/\r?\n/)[0]);
    keyFilePath = path;
    source = `--key-file ${path}`;
  } else if (env.OPERATOR_PRIVATE_KEY) {
    key = normalizePrivateKey(env.OPERATOR_PRIVATE_KEY);
    source = "OPERATOR_PRIVATE_KEY";
  } else if (operator?.key?.type === "keyFile" && operator.key.value) {
    const path = operator.key.value;
    if (!existsSync(path)) throw new Error(`Profile keyFile not found: ${path}`);
    key = normalizePrivateKey(readFileSync(path, "utf8").split(/\r?\n/)[0]);
    keyFilePath = path;
    source = `profile keyFile ${path}`;
  } else if (operator?.key?.type === "env" && operator.key.value && env[operator.key.value]) {
    key = normalizePrivateKey(env[operator.key.value]);
    source = `profile env ${operator.key.value}`;
  }

  if (key) {
    if (!local && isAnvilDefaultKey(key)) {
      throw new Error(
        "Refusing Anvil account #0 key on a non-local RPC. " +
          "Use clanker login, or a real OPERATOR_PRIVATE_KEY / --key-file.",
      );
    }
    const keyPointer =
      keyFilePath
        ? { type: "keyFile", value: keyFilePath }
        : source === "OPERATOR_PRIVATE_KEY" || source?.startsWith("profile env")
          ? { type: "env", value: "OPERATOR_PRIVATE_KEY" }
          : { type: "env", value: "OPERATOR_PRIVATE_KEY" };
    const signer = await localSignerFromKey(rpc, key, {
      source,
      keyPointer,
      network: { ...network, rpc },
    });
    if (
      operator?.owner &&
      getAddress(operator.owner) !== getAddress(signer.address)
    ) {
      throw new Error(
        `Signing address ${signer.address} does not match operator.json owner ${operator.owner}`,
      );
    }
    return signer;
  }

  // Privy vault.
  const session = loadPrivySession(home);
  const wantsPrivy =
    operator?.key?.type === "privy" || Boolean(session?.accessToken);

  if (wantsPrivy) {
    if (!session?.accessToken || !session?.address || !session?.walletId) {
      throw new Error(
        "Privy session missing — run clanker login (or use --key-file / OPERATOR_PRIVATE_KEY).",
      );
    }
    if (
      operator?.key?.type === "privy" &&
      operator.key.value &&
      operator.key.value !== session.walletId
    ) {
      throw new Error(
        `Privy wallet ${session.walletId} does not match operator.json ${operator.key.value} — run clanker login again`,
      );
    }
    if (
      operator?.owner &&
      getAddress(operator.owner) !== getAddress(session.address)
    ) {
      throw new Error(
        `Privy address ${session.address} does not match operator.json owner ${operator.owner}`,
      );
    }
    return privySignerFromSession(
      rpc,
      {
        address: session.address,
        walletId: session.walletId,
        home,
        fetchImpl: opts.fetchImpl,
      },
      {
        source: "privy session",
        keyPointer: { type: "privy", value: session.walletId },
        network: { ...network, rpc },
      },
    );
  }

  if (local) {
    return localSignerFromKey(
      rpc,
      normalizePrivateKey(ANVIL_DEFAULT_PRIVATE_KEY),
      {
        source: "anvil-default (local RPC)",
        keyPointer: { type: "env", value: "OPERATOR_PRIVATE_KEY" },
        network: { ...network, rpc },
      },
    );
  }

  throw new Error(
    "Owner actions need clanker login (email vault), or a signing key (--key-file / OPERATOR_PRIVATE_KEY). " +
      "A read-only profile can still run whoami, bots, fund, and doctor.",
  );
}

/**
 * Back-compat: local hex only (used by forge deploy etc.).
 * Prefer resolveOperatorSigner for pair/mint.
 */
export function resolveOperatorKeyLocal(argv, opts) {
  return resolveOperatorKey(argv, opts);
}

#!/usr/bin/env node
/**
 * On-chain identity commands (ClankerIdentity contract).
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  keccak256,
  toBytes,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { clankerIdentityAbi } from "../lib/clanker-identity-abi.mjs";

const ANVIL_DEFAULT_PRIVATE_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

function labelToId(label) {
  return keccak256(toBytes(label));
}

function resolveRegistry(argv) {
  let registry = process.env.REGISTRY_ADDRESS;
  let rpc = process.env.CHAIN_RPC_URL ?? "http://127.0.0.1:8545";
  let key = process.env.OPERATOR_PRIVATE_KEY ?? ANVIL_DEFAULT_PRIVATE_KEY;
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--rpc" && argv[i + 1]) rpc = argv[++i];
    else if (a === "--registry" && argv[i + 1]) registry = argv[++i];
    else if (a === "--key" && argv[i + 1]) key = argv[++i];
  }
  if (!registry) {
    throw new Error("REGISTRY_ADDRESS or --registry is required");
  }
  return { registry, rpc, key };
}

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

async function walletFromKey(rpc, key) {
  const account = privateKeyToAccount(key);
  const transport = http(rpc);
  const chain = await chainFromRpc(rpc);
  return {
    account,
    public: createPublicClient({ chain, transport }),
    wallet: createWalletClient({ account, chain, transport }),
  };
}

export async function chainMintOperator(label, argv) {
  const { registry, rpc, key } = resolveRegistry(argv);
  const { public: pub, wallet } = await walletFromKey(rpc, key);
  const operatorFee = await pub.readContract({
    address: registry,
    abi: clankerIdentityAbi,
    functionName: "operatorFee",
  });
  const hash = await wallet.writeContract({
    address: registry,
    abi: clankerIdentityAbi,
    functionName: "registerOperator",
    args: [label],
    value: operatorFee,
  });
  console.log(JSON.stringify({ ok: true, label, operator_id: labelToId(label), tx: hash }));
}

export async function chainMintBot(botLabel, operatorLabel, argv) {
  const { registry, rpc, key } = resolveRegistry(argv);
  const { public: pub, wallet } = await walletFromKey(rpc, key);
  let botPrivateKey;
  const positional = [];
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--bot-key" && argv[i + 1]) {
      botPrivateKey = argv[++i];
    } else if (a.startsWith("--")) {
      if (argv[i + 1] && !argv[i + 1].startsWith("--")) i += 1;
    } else {
      positional.push(a);
    }
  }
  if (!botPrivateKey) {
    botPrivateKey = generatePrivateKey();
  }
  const botAccount = privateKeyToAccount(botPrivateKey);
  const operatorIdBytes = labelToId(operatorLabel);

  // Persist the key BEFORE broadcasting: registration now costs ETH, so a
  // crash between tx-send and key-write would strand a paid, orphaned bot
  // whose key exists only in memory (recoverable only via rotateBotKey).
  const keyDir = join(homedir(), ".openclaw", "keys");
  mkdirSync(keyDir, { recursive: true });
  const keyPath = join(keyDir, `${botLabel}.key`);
  if (existsSync(keyPath)) {
    throw new Error(
      `Key file already exists at ${keyPath}; refusing to overwrite. ` +
        `Remove it or choose a different bot label.`,
    );
  }
  writeFileSync(keyPath, `${botPrivateKey}\n`, { flag: "wx", mode: 0o600 });

  const botFee = await pub.readContract({
    address: registry,
    abi: clankerIdentityAbi,
    functionName: "botFee",
  });
  const hash = await wallet.writeContract({
    address: registry,
    abi: clankerIdentityAbi,
    functionName: "registerBot",
    args: [operatorIdBytes, botLabel, botAccount.address],
    value: botFee,
  });

  console.log(
    JSON.stringify({
      ok: true,
      bot_id: botLabel,
      operator_id: operatorLabel,
      bot_key: botAccount.address,
      key_path: keyPath,
      tx: hash,
    }),
  );
}

export async function chainRotateBotKey(botLabel, newKey, argv) {
  const { registry, rpc, key } = resolveRegistry(argv);
  const { wallet } = await walletFromKey(rpc, key);
  const botIdBytes = labelToId(botLabel);
  const hash = await wallet.writeContract({
    address: registry,
    abi: clankerIdentityAbi,
    functionName: "rotateBotKey",
    args: [botIdBytes, newKey],
  });
  console.log(JSON.stringify({ ok: true, bot_id: botLabel, new_key: newKey, tx: hash }));
}

export async function chainRevokeBot(botLabel, argv) {
  const { registry, rpc, key } = resolveRegistry(argv);
  const { wallet } = await walletFromKey(rpc, key);
  const botIdBytes = labelToId(botLabel);
  const hash = await wallet.writeContract({
    address: registry,
    abi: clankerIdentityAbi,
    functionName: "revokeBot",
    args: [botIdBytes],
  });
  console.log(JSON.stringify({ ok: true, bot_id: botLabel, tx: hash }));
}

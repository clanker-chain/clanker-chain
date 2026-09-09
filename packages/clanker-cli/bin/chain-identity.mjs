#!/usr/bin/env node
/**
 * On-chain identity commands (ClankerIdentity contract).
 */

import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { clankerIdentityAbi } from "../lib/clanker-identity-abi.mjs";
import { assertSafeBotLabel, writeBotKeyFiles } from "../lib/keys.mjs";
import { harnessSnippet, writeOperator } from "../lib/profile.mjs";
import { labelToId } from "../lib/identity-query.mjs";
import { resolveOperatorKey } from "../lib/resolve.mjs";

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

async function waitOk(pub, hash) {
  const receipt = await pub.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") {
    throw new Error(`Transaction reverted: ${hash}`);
  }
  return receipt;
}

/**
 * Shared resolve for mutating chain commands (Anvil-guarded).
 * @param {string[]} argv
 */
export function resolveForWrite(argv) {
  return resolveOperatorKey(argv);
}

export async function chainMintOperator(label, argv, opts = {}) {
  const { key, address, network, keyPointer } = resolveOperatorKey(argv, opts);
  const { public: pub, wallet } = await walletFromKey(network.rpc, key);
  const operatorFee = await pub.readContract({
    address: network.registry,
    abi: clankerIdentityAbi,
    functionName: "operatorFee",
  });
  const hash = await wallet.writeContract({
    address: network.registry,
    abi: clankerIdentityAbi,
    functionName: "registerOperator",
    args: [label],
    value: operatorFee,
  });
  await waitOk(pub, hash);

  writeOperator(
    { label, owner: address, key: opts.keyPointer ?? keyPointer },
    opts.home ?? network.home,
  );

  return {
    ok: true,
    label,
    operator_id: labelToId(label),
    owner: address,
    tx: hash,
  };
}

export async function chainMintBot(botLabel, operatorLabel, argv, opts = {}) {
  assertSafeBotLabel(botLabel);
  const { key, network } = resolveOperatorKey(argv, opts);
  const { public: pub, wallet } = await walletFromKey(network.rpc, key);
  let botPrivateKey;
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--bot-key" && argv[i + 1]) {
      botPrivateKey = argv[++i];
    }
  }
  if (!botPrivateKey) {
    botPrivateKey = generatePrivateKey();
  }
  const botAccount = privateKeyToAccount(botPrivateKey);
  const operatorIdBytes = labelToId(operatorLabel);

  // Persist the key BEFORE broadcasting: registration costs ETH.
  const { openclawPath, clankerPath } = writeBotKeyFiles(
    botLabel,
    botPrivateKey,
    {
      env: opts.env,
      openclawKeysDir: opts.openclawKeysDir,
      clankerKeysDir: opts.clankerKeysDir,
    },
  );

  const botFee = await pub.readContract({
    address: network.registry,
    abi: clankerIdentityAbi,
    functionName: "botFee",
  });
  const hash = await wallet.writeContract({
    address: network.registry,
    abi: clankerIdentityAbi,
    functionName: "registerBot",
    args: [operatorIdBytes, botLabel, botAccount.address],
    value: botFee,
  });
  await waitOk(pub, hash);

  const channelsMqtt = harnessSnippet({
    botId: botLabel,
    operatorId: operatorLabel,
    network,
  });

  return {
    ok: true,
    bot_id: botLabel,
    operator_id: operatorLabel,
    bot_key: botAccount.address,
    key_path: openclawPath,
    clanker_key_path: clankerPath,
    tx: hash,
    channels_mqtt: channelsMqtt,
  };
}

export async function chainRotateBotKey(botLabel, newKey, argv, opts = {}) {
  const { key, network } = resolveOperatorKey(argv, opts);
  const { public: pub, wallet } = await walletFromKey(network.rpc, key);
  const botIdBytes = labelToId(botLabel);
  const hash = await wallet.writeContract({
    address: network.registry,
    abi: clankerIdentityAbi,
    functionName: "rotateBotKey",
    args: [botIdBytes, newKey],
  });
  await waitOk(pub, hash);
  return { ok: true, bot_id: botLabel, new_key: newKey, tx: hash };
}

export async function chainRevokeBot(botLabel, argv, opts = {}) {
  const { key, network } = resolveOperatorKey(argv, opts);
  const { public: pub, wallet } = await walletFromKey(network.rpc, key);
  const botIdBytes = labelToId(botLabel);
  const hash = await wallet.writeContract({
    address: network.registry,
    abi: clankerIdentityAbi,
    functionName: "revokeBot",
    args: [botIdBytes],
  });
  await waitOk(pub, hash);
  return { ok: true, bot_id: botLabel, tx: hash };
}

export async function chainProposeOperatorTransfer(label, newOwner, argv, opts = {}) {
  const { key, network } = resolveOperatorKey(argv, opts);
  const { public: pub, wallet } = await walletFromKey(network.rpc, key);
  const id = labelToId(label);
  const hash = await wallet.writeContract({
    address: network.registry,
    abi: clankerIdentityAbi,
    functionName: "proposeOperatorTransfer",
    args: [id, newOwner],
  });
  await waitOk(pub, hash);
  return { ok: true, label, proposed: newOwner, tx: hash };
}

export async function chainAcceptOperatorTransfer(label, argv, opts = {}) {
  const { key, address, network, keyPointer } = resolveOperatorKey(argv, opts);
  const { public: pub, wallet } = await walletFromKey(network.rpc, key);
  const id = labelToId(label);
  const hash = await wallet.writeContract({
    address: network.registry,
    abi: clankerIdentityAbi,
    functionName: "acceptOperatorTransfer",
    args: [id],
  });
  await waitOk(pub, hash);
  writeOperator(
    {
      label,
      owner: address,
      key: opts.keyPointer ?? keyPointer,
    },
    opts.home ?? network.home,
  );
  return { ok: true, label, owner: address, tx: hash };
}

export { labelToId };

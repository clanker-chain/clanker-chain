#!/usr/bin/env node
/**
 * On-chain identity commands (ClankerIdentity contract).
 */

import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { clankerIdentityAbi } from "../lib/clanker-identity-abi.mjs";
import { assertSafeBotLabel, writeBotKeyFiles } from "../lib/keys.mjs";
import { harnessSnippet, writeOperator } from "../lib/profile.mjs";
import { labelToId } from "../lib/identity-query.mjs";
import { resolveOperatorSigner } from "../lib/operator-signer.mjs";
import { resolveOperatorKey } from "../lib/resolve.mjs";

async function waitOk(pub, hash) {
  const receipt = await pub.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") {
    throw new Error(`Transaction reverted: ${hash}`);
  }
  return receipt;
}

/**
 * Shared resolve for mutating chain commands (Anvil-guarded).
 * Prefer resolveOperatorSigner for Privy + local.
 * @param {string[]} argv
 */
export function resolveForWrite(argv) {
  return resolveOperatorKey(argv);
}

export async function chainMintOperator(label, argv, opts = {}) {
  const signer = await resolveOperatorSigner(argv, opts);
  const pub = signer.publicClient;
  const operatorFee = await pub.readContract({
    address: signer.network.registry,
    abi: clankerIdentityAbi,
    functionName: "operatorFee",
  });
  const hash = await signer.writeContract({
    address: signer.network.registry,
    abi: clankerIdentityAbi,
    functionName: "registerOperator",
    args: [label],
    value: operatorFee,
  });
  await waitOk(pub, hash);

  writeOperator(
    {
      label,
      owner: signer.address,
      key: opts.keyPointer ?? signer.keyPointer,
    },
    opts.home ?? signer.network.home,
  );

  return {
    ok: true,
    label,
    operator_id: labelToId(label),
    owner: signer.address,
    tx: hash,
  };
}

export async function chainMintBot(botLabel, operatorLabel, argv, opts = {}) {
  assertSafeBotLabel(botLabel);
  const signer = await resolveOperatorSigner(argv, opts);
  const pub = signer.publicClient;
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
    address: signer.network.registry,
    abi: clankerIdentityAbi,
    functionName: "botFee",
  });
  const hash = await signer.writeContract({
    address: signer.network.registry,
    abi: clankerIdentityAbi,
    functionName: "registerBot",
    args: [operatorIdBytes, botLabel, botAccount.address],
    value: botFee,
  });
  await waitOk(pub, hash);

  const channelsMqtt = harnessSnippet({
    botId: botLabel,
    operatorId: operatorLabel,
    network: signer.network,
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
  const signer = await resolveOperatorSigner(argv, opts);
  const pub = signer.publicClient;
  const botIdBytes = labelToId(botLabel);
  const hash = await signer.writeContract({
    address: signer.network.registry,
    abi: clankerIdentityAbi,
    functionName: "rotateBotKey",
    args: [botIdBytes, newKey],
  });
  await waitOk(pub, hash);
  return { ok: true, bot_id: botLabel, new_key: newKey, tx: hash };
}

export async function chainRevokeBot(botLabel, argv, opts = {}) {
  const signer = await resolveOperatorSigner(argv, opts);
  const pub = signer.publicClient;
  const botIdBytes = labelToId(botLabel);
  const hash = await signer.writeContract({
    address: signer.network.registry,
    abi: clankerIdentityAbi,
    functionName: "revokeBot",
    args: [botIdBytes],
  });
  await waitOk(pub, hash);
  return { ok: true, bot_id: botLabel, tx: hash };
}

export async function chainProposeOperatorTransfer(label, newOwner, argv, opts = {}) {
  const signer = await resolveOperatorSigner(argv, opts);
  const pub = signer.publicClient;
  const id = labelToId(label);
  const hash = await signer.writeContract({
    address: signer.network.registry,
    abi: clankerIdentityAbi,
    functionName: "proposeOperatorTransfer",
    args: [id, newOwner],
  });
  await waitOk(pub, hash);
  return { ok: true, label, proposed: newOwner, tx: hash };
}

export async function chainAcceptOperatorTransfer(label, argv, opts = {}) {
  const signer = await resolveOperatorSigner(argv, opts);
  const pub = signer.publicClient;
  const id = labelToId(label);
  const hash = await signer.writeContract({
    address: signer.network.registry,
    abi: clankerIdentityAbi,
    functionName: "acceptOperatorTransfer",
    args: [id],
  });
  await waitOk(pub, hash);
  writeOperator(
    {
      label,
      owner: signer.address,
      key: opts.keyPointer ?? signer.keyPointer,
    },
    opts.home ?? signer.network.home,
  );
  return { ok: true, label, owner: signer.address, tx: hash };
}

export { labelToId };

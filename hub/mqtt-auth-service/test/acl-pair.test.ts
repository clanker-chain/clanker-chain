/**
 * ACL + pairing integration tests (Anvil + mqtt-auth).
 */
import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "path";
import {
  createPublicClient,
  createWalletClient,
  http,
  keccak256,
  toBytes,
  type Hex,
  type PublicClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";
import { clankerIdentityAbi } from "../../../packages/identity-node-client/src/abi/clanker-identity";
import {
  ANVIL_DEFAULT_KEY,
  ANVIL_KEY_1,
  ANVIL_KEY_2,
  deployTestRegistry,
  foundryOnPath,
} from "../../test-utils/deploy-registry";

const repoRoot = join(import.meta.dir, "../../..");
const chainDir = join(repoRoot, "chain");
const mqttAuthServiceDir = join(repoRoot, "hub/mqtt-auth-service");

/** Anvil accounts #3–#5. Distinct per concurrent test so nonces never collide. */
const ANVIL_KEY_3 =
  "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6" as Hex;
const ANVIL_KEY_4 =
  "0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a" as Hex;
const ANVIL_KEY_5 =
  "0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba" as Hex;

async function waitMined(pc: PublicClient, hash: Hex): Promise<void> {
  await pc.waitForTransactionReceipt({ hash });
}

function skipSiwe(): string | null {
  if (process.env.MQTT_EVM_TESTS_SKIP === "1" || process.env.MQTT_EVM_TESTS_SKIP === "true") {
    return "MQTT_EVM_TESTS_SKIP is set";
  }
  if (!foundryOnPath()) return "anvil or forge not on PATH";
  return null;
}

async function waitHttpOk(url: string, max = 40): Promise<void> {
  for (let i = 0; i < max; i++) {
    try {
      const r = await fetch(url);
      if (r.ok) {
        const ct = r.headers.get("content-type") ?? "";
        if (ct.includes("application/json")) {
          const body = (await r.json()) as { ok?: boolean };
          if (body.ok === true) return;
        } else {
          return;
        }
      }
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`timeout waiting for ${url}`);
}

interface Harness {
  cleanup: () => Promise<void>;
  mqttUrl: string;
  registry: Hex;
  rpcUrl: string;
  pc: PublicClient;
  operatorLabel: string;
  botId: string;
  secondBotId: string;
}

const skip = skipSiwe();
let harness: Harness | null = null;

beforeAll(async () => {
  if (skip) return;
  const port = 21000 + Math.floor(Math.random() * 4000);
  const rpcUrl = `http://127.0.0.1:${port}`;
  const anvil = Bun.spawn(["anvil", "--port", String(port)], {
    stdout: "ignore",
    stderr: "ignore",
  });
  for (let i = 0; i < 50; i++) {
    const ping = Bun.spawnSync(["cast", "chain-id", "--rpc-url", rpcUrl], {
      stdout: "ignore",
      stderr: "ignore",
    });
    if (ping.exitCode === 0) break;
    await new Promise((r) => setTimeout(r, 100));
  }

  const { registry } = await deployTestRegistry({ rpcUrl, chainDir });
  const operatorLabel = "org.openclaw.acl-test";
  const botId = "openclaw.acl.bot-1";
  const secondBotId = "openclaw.acl.bot-2";
  const account0 = privateKeyToAccount(ANVIL_DEFAULT_KEY);
  const pc = createPublicClient({ chain: foundry, transport: http(rpcUrl) });
  const wallet = createWalletClient({
    account: account0,
    chain: foundry,
    transport: http(rpcUrl),
  });
  await waitMined(
    pc,
    await wallet.writeContract({
      address: registry,
      abi: clankerIdentityAbi,
      functionName: "registerOperator",
      args: [operatorLabel],
    }),
  );
  const operatorIdBytes = keccak256(toBytes(operatorLabel));
  await waitMined(
    pc,
    await wallet.writeContract({
      address: registry,
      abi: clankerIdentityAbi,
      functionName: "registerBot",
      args: [operatorIdBytes as Hex, botId, privateKeyToAccount(ANVIL_KEY_1).address],
    }),
  );
  await waitMined(
    pc,
    await wallet.writeContract({
      address: registry,
      abi: clankerIdentityAbi,
      functionName: "registerBot",
      args: [operatorIdBytes as Hex, secondBotId, privateKeyToAccount(ANVIL_KEY_2).address],
    }),
  );

  // Pre-fund peer accounts so concurrent tests do not race on account #0 nonces.
  for (const key of [ANVIL_KEY_3, ANVIL_KEY_4, ANVIL_KEY_5]) {
    await waitMined(
      pc,
      await wallet.sendTransaction({
        to: privateKeyToAccount(key).address,
        value: 10n ** 18n,
      }),
    );
  }

  const pairDir = mkdtempSync(join(tmpdir(), "pair-acl-"));
  const mqttPort = 23000 + Math.floor(Math.random() * 3000);
  const mqttUrl = `http://127.0.0.1:${mqttPort}`;
  const mqttProc = Bun.spawn(["bun", "run", "src/server.ts"], {
    cwd: mqttAuthServiceDir,
    stdout: "ignore",
    stderr: "pipe",
    env: {
      ...process.env,
      MQTT_AUTH_PORT: String(mqttPort),
      CHAIN_RPC_URL: rpcUrl,
      REGISTRY_ADDRESS: registry,
      REGISTRY_CACHE_TTL_MS: "0",
      PAIRING_STORE_PATH: join(pairDir, "pairing.json"),
    },
  });
  await waitHttpOk(`${mqttUrl}/health`);

  harness = {
    mqttUrl,
    registry,
    rpcUrl,
    pc,
    operatorLabel,
    botId,
    secondBotId,
    cleanup: async () => {
      mqttProc.kill();
      anvil.kill();
      await Promise.all([mqttProc.exited, anvil.exited]);
      rmSync(pairDir, { recursive: true, force: true });
    },
  };
}, 60_000);

afterAll(async () => {
  if (harness) await harness.cleanup();
}, 30_000);

test("POST /acl own inbox / announce / sibling / stranger", async () => {
  if (skip) return;
  const h = harness!;

  const subOwn = await fetch(`${h.mqttUrl}/acl`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: h.botId, topic: `bots/${h.botId}/inbox`, acc: 4 }),
  });
  expect(subOwn.status).toBe(200);

  const pubStranger = await fetch(`${h.mqttUrl}/acl`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: h.botId, topic: "bots/stranger.bot/inbox", acc: 2 }),
  });
  expect(pubStranger.status).toBe(403);
  expect(await pubStranger.text()).toMatch(/not_paired|peer_not_active/);

  const announcePub = await fetch(`${h.mqttUrl}/acl`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: h.botId, topic: "bots/all/announce", acc: 2 }),
  });
  expect(announcePub.status).toBe(403);

  const announceSub = await fetch(`${h.mqttUrl}/acl`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: h.botId, topic: "bots/all/announce", acc: 4 }),
  });
  expect(announceSub.status).toBe(200);

  const pubSibling = await fetch(`${h.mqttUrl}/acl`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      username: h.botId,
      topic: `bots/${h.secondBotId}/inbox`,
      acc: 2,
    }),
  });
  expect(pubSibling.status).toBe(200);
});

test("pair add unlocks cross-operator inbox publish (one-way)", async () => {
  if (skip) return;
  const h = harness!;

  const account3 = privateKeyToAccount(ANVIL_KEY_3);
  const wallet3 = createWalletClient({
    account: account3,
    chain: foundry,
    transport: http(h.rpcUrl),
  });
  const peerOpLabel = "org.openclaw.peer-pair";
  const peerBotId = "openclaw.peer.pair-bot";
  await waitMined(
    h.pc,
    await wallet3.writeContract({
      address: h.registry,
      abi: clankerIdentityAbi,
      functionName: "registerOperator",
      args: [peerOpLabel],
    }),
  );
  const peerOpId = keccak256(toBytes(peerOpLabel));
  await waitMined(
    h.pc,
    await wallet3.writeContract({
      address: h.registry,
      abi: clankerIdentityAbi,
      functionName: "registerBot",
      args: [peerOpId, peerBotId, account3.address],
    }),
  );

  const before = await fetch(`${h.mqttUrl}/acl`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      username: peerBotId,
      topic: `bots/${h.botId}/inbox`,
      acc: 2,
    }),
  });
  expect(before.status).toBe(403);

  const owner = privateKeyToAccount(ANVIL_DEFAULT_KEY);
  const nonceRes = await fetch(
    `${h.mqttUrl}/pair-nonce?operator_id=${encodeURIComponent(h.operatorLabel)}&action=add&peer_label=${encodeURIComponent(peerOpLabel)}`,
  );
  expect(nonceRes.status).toBe(200);
  const { nonce, message } = (await nonceRes.json()) as { nonce: string; message: string };
  const sig = await owner.signMessage({ message });
  const pairRes = await fetch(`${h.mqttUrl}/pair`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      operator_id: h.operatorLabel,
      peer_label: peerOpLabel,
      action: "add",
      nonce,
      signature: sig,
    }),
  });
  expect(pairRes.status).toBe(200);
  const pairBody = (await pairRes.json()) as { mutual?: boolean; error?: string };
  expect(pairBody.error).toBeUndefined();
  expect(pairBody.mutual).toBe(false);

  const after = await fetch(`${h.mqttUrl}/acl`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      username: peerBotId,
      topic: `bots/${h.botId}/inbox`,
      acc: 2,
    }),
  });
  expect(after.status).toBe(200);

  const reverse = await fetch(`${h.mqttUrl}/acl`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      username: h.botId,
      topic: `bots/${peerBotId}/inbox`,
      acc: 2,
    }),
  });
  expect(reverse.status).toBe(403);

  // Wrong key rejected
  const badNonce = await fetch(
    `${h.mqttUrl}/pair-nonce?operator_id=${encodeURIComponent(h.operatorLabel)}&action=add&peer_label=${encodeURIComponent(peerOpLabel)}`,
  );
  const badBody = (await badNonce.json()) as { nonce: string; message: string };
  const badSig = await privateKeyToAccount(ANVIL_KEY_1).signMessage({
    message: badBody.message,
  });
  const badPair = await fetch(`${h.mqttUrl}/pair`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      operator_id: h.operatorLabel,
      peer_label: peerOpLabel,
      action: "add",
      nonce: badBody.nonce,
      signature: badSig,
    }),
  });
  expect(badPair.status).toBe(403);
});

test("pair list and remove via signed HTTP", async () => {
  if (skip) return;
  const h = harness!;
  const peerOpLabel = "org.openclaw.peer-list";
  const owner = privateKeyToAccount(ANVIL_DEFAULT_KEY);

  // Dedicated Anvil key so this can run concurrent with the one-way pair test.
  const account4 = privateKeyToAccount(ANVIL_KEY_4);
  const wallet4 = createWalletClient({
    account: account4,
    chain: foundry,
    transport: http(h.rpcUrl),
  });
  await waitMined(
    h.pc,
    await wallet4.writeContract({
      address: h.registry,
      abi: clankerIdentityAbi,
      functionName: "registerOperator",
      args: [peerOpLabel],
    }),
  );

  const addNonce = await fetch(
    `${h.mqttUrl}/pair-nonce?operator_id=${encodeURIComponent(h.operatorLabel)}&action=add&peer_label=${encodeURIComponent(peerOpLabel)}`,
  );
  const addBody = (await addNonce.json()) as { nonce: string; message: string };
  const addSig = await owner.signMessage({ message: addBody.message });
  const addRes = await fetch(`${h.mqttUrl}/pair`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      operator_id: h.operatorLabel,
      peer_label: peerOpLabel,
      action: "add",
      nonce: addBody.nonce,
      signature: addSig,
    }),
  });
  expect(addRes.status).toBe(200);

  const listNonce = await fetch(
    `${h.mqttUrl}/pair-nonce?operator_id=${encodeURIComponent(h.operatorLabel)}&action=list`,
  );
  expect(listNonce.status).toBe(200);
  const listBody = (await listNonce.json()) as { nonce: string; message: string };
  const listSig = await owner.signMessage({ message: listBody.message });
  const listRes = await fetch(
    `${h.mqttUrl}/pair?operator_id=${encodeURIComponent(h.operatorLabel)}&nonce=${encodeURIComponent(listBody.nonce)}&signature=${encodeURIComponent(listSig)}`,
  );
  expect(listRes.status).toBe(200);
  const listed = (await listRes.json()) as {
    allows?: Array<{ peer_operator_id: string }>;
  };
  const peerId = keccak256(toBytes(peerOpLabel)).toLowerCase();
  expect(
    (listed.allows ?? []).some((a) => String(a.peer_operator_id).toLowerCase() === peerId),
  ).toBe(true);

  const remNonce = await fetch(
    `${h.mqttUrl}/pair-nonce?operator_id=${encodeURIComponent(h.operatorLabel)}&action=remove&peer_label=${encodeURIComponent(peerOpLabel)}`,
  );
  const remBody = (await remNonce.json()) as { nonce: string; message: string };
  const remSig = await owner.signMessage({ message: remBody.message });
  const remRes = await fetch(`${h.mqttUrl}/pair`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      operator_id: h.operatorLabel,
      peer_label: peerOpLabel,
      action: "remove",
      nonce: remBody.nonce,
      signature: remSig,
    }),
  });
  expect(remRes.status).toBe(200);

  const list2Nonce = await fetch(
    `${h.mqttUrl}/pair-nonce?operator_id=${encodeURIComponent(h.operatorLabel)}&action=list`,
  );
  const list2Body = (await list2Nonce.json()) as { nonce: string; message: string };
  const list2Sig = await owner.signMessage({ message: list2Body.message });
  const list2Res = await fetch(
    `${h.mqttUrl}/pair?operator_id=${encodeURIComponent(h.operatorLabel)}&nonce=${encodeURIComponent(list2Body.nonce)}&signature=${encodeURIComponent(list2Sig)}`,
  );
  const listed2 = (await list2Res.json()) as {
    allows?: Array<{ peer_operator_id: string }>;
  };
  expect(
    (listed2.allows ?? []).some((a) => String(a.peer_operator_id).toLowerCase() === peerId),
  ).toBe(false);
});

test("mutual pair unlocks dm/{a}::{b} ACL", async () => {
  if (skip) return;
  const h = harness!;

  // Self-contained: do not rely on the one-way pair test having run first.
  const peerOpLabel = "org.openclaw.peer-mutual";
  const peerBotId = "openclaw.peer.mutual-bot";
  const left = h.botId;
  const right = peerBotId;
  const peerOwner = privateKeyToAccount(ANVIL_KEY_5);
  const wallet5 = createWalletClient({
    account: peerOwner,
    chain: foundry,
    transport: http(h.rpcUrl),
  });
  await waitMined(
    h.pc,
    await wallet5.writeContract({
      address: h.registry,
      abi: clankerIdentityAbi,
      functionName: "registerOperator",
      args: [peerOpLabel],
    }),
  );
  const peerOpId = keccak256(toBytes(peerOpLabel));
  await waitMined(
    h.pc,
    await wallet5.writeContract({
      address: h.registry,
      abi: clankerIdentityAbi,
      functionName: "registerBot",
      args: [peerOpId, peerBotId, peerOwner.address],
    }),
  );

  const owner = privateKeyToAccount(ANVIL_DEFAULT_KEY);
  const forwardNonce = await fetch(
    `${h.mqttUrl}/pair-nonce?operator_id=${encodeURIComponent(h.operatorLabel)}&action=add&peer_label=${encodeURIComponent(peerOpLabel)}`,
  );
  expect(forwardNonce.status).toBe(200);
  const forwardBody = (await forwardNonce.json()) as { nonce: string; message: string };
  const forwardSig = await owner.signMessage({ message: forwardBody.message });
  const forwardRes = await fetch(`${h.mqttUrl}/pair`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      operator_id: h.operatorLabel,
      peer_label: peerOpLabel,
      action: "add",
      nonce: forwardBody.nonce,
      signature: forwardSig,
    }),
  });
  expect(forwardRes.status).toBe(200);

  const segment = [left, right].sort().join("::");
  const dmTopic = `dm/${segment}/coordination`;

  const n = await fetch(
    `${h.mqttUrl}/pair-nonce?operator_id=${encodeURIComponent(peerOpLabel)}&action=add&peer_label=${encodeURIComponent(h.operatorLabel)}`,
  );
  expect(n.status).toBe(200);
  const body = (await n.json()) as { nonce: string; message: string };
  const sig = await peerOwner.signMessage({ message: body.message });
  const pairRes = await fetch(`${h.mqttUrl}/pair`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      operator_id: peerOpLabel,
      peer_label: h.operatorLabel,
      action: "add",
      nonce: body.nonce,
      signature: sig,
    }),
  });
  expect(pairRes.status).toBe(200);
  const pairJson = (await pairRes.json()) as { mutual?: boolean };
  expect(pairJson.mutual).toBe(true);

  const after = await fetch(`${h.mqttUrl}/acl`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: left, topic: dmTopic, acc: 2 }),
  });
  expect(after.status).toBe(200);

  const peerAcl = await fetch(`${h.mqttUrl}/acl`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: right, topic: dmTopic, acc: 1 }),
  });
  expect(peerAcl.status).toBe(200);

  // Legacy hyphen-joined segment is not a valid pair topic (encoding covered in unit tests).
  const legacy = [left, right].sort().join("-");
  const legacyDeny = await fetch(`${h.mqttUrl}/acl`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      username: left,
      topic: `dm/${legacy}/coordination`,
      acc: 2,
    }),
  });
  expect(legacyDeny.status).toBe(403);
  expect(await legacyDeny.text()).toMatch(/denied|dm_not/);
});

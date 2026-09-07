import assert from "node:assert/strict";
import test from "node:test";
import type { Address, Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { keccak256, toBytes } from "viem";
import { signEnvelope, type ClankerEip712Domain } from "../src/eip712.js";
import {
  IdentityClient,
  type IdentityRegistryReader,
  type OnchainBot,
  type OnchainOperator,
} from "../src/index.js";

const TEST_KEY =
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as const;
const REGISTRY = "0x1234567890123456789012345678901234567890" as Address;
const BOT_ID = "openclaw.test.bot";
const OPERATOR_ID = "org.openclaw.test";
const DOMAIN: ClankerEip712Domain = { chainId: 31337, registryAddress: REGISTRY };

function opId(): Hex {
  return keccak256(toBytes(OPERATOR_ID)) as Hex;
}

function makeFakeRegistry(state: {
  operator?: OnchainOperator | null;
  bot?: OnchainBot | null;
  domainError?: Error;
}): IdentityRegistryReader & { setOperator: (o: OnchainOperator | null) => void; setBot: (b: OnchainBot | null) => void } {
  let operator = state.operator ?? null;
  let bot = state.bot ?? null;
  return {
    setOperator(o) {
      operator = o;
    },
    setBot(b) {
      bot = b;
    },
    async getBotByLabel(label: string) {
      if (label !== BOT_ID) return null;
      return bot;
    },
    async getOperatorByLabel(label: string) {
      if (label !== OPERATOR_ID) return null;
      return operator;
    },
    async getOperatorById(id: Hex) {
      if (id.toLowerCase() !== opId().toLowerCase()) return null;
      return operator;
    },
    async getEip712Domain() {
      if (state.domainError) throw state.domainError;
      return DOMAIN;
    },
  };
}

const activeOperator: OnchainOperator = {
  owner: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
  status: "active",
  registeredAt: 1n,
  revokedAt: 0n,
};

const activeBot: OnchainBot = {
  botId: BOT_ID,
  operatorId: opId(),
  botKey: privateKeyToAccount(TEST_KEY).address,
  status: "active",
  registeredAt: 1n,
  revokedAt: 0n,
};

test("init fails when operator is missing", async () => {
  const registry = makeFakeRegistry({ operator: null, bot: activeBot });
  const client = new IdentityClient({
    botId: BOT_ID,
    operatorId: OPERATOR_ID,
    ethPrivateKey: TEST_KEY,
    registry,
  });
  await assert.rejects(() => client.init(), /Operator not registered/i);
});

test("init fails when bot status is retired", async () => {
  const registry = makeFakeRegistry({
    operator: activeOperator,
    bot: { ...activeBot, status: "retired", revokedAt: 2n },
  });
  const client = new IdentityClient({
    botId: BOT_ID,
    operatorId: OPERATOR_ID,
    ethPrivateKey: TEST_KEY,
    registry,
  });
  await assert.rejects(() => client.init(), /Bot status is retired/i);
});

test("init fails when RPC domain read fails", async () => {
  const registry = makeFakeRegistry({
    operator: activeOperator,
    bot: activeBot,
    domainError: new Error("RPC unreachable"),
  });
  const client = new IdentityClient({
    botId: BOT_ID,
    operatorId: OPERATOR_ID,
    ethPrivateKey: TEST_KEY,
    registry,
  });
  await assert.rejects(() => client.init(), /RPC unreachable/);
});

test("init fails when operator status is retired", async () => {
  const registry = makeFakeRegistry({
    operator: { ...activeOperator, status: "retired", revokedAt: 2n },
    bot: activeBot,
  });
  const client = new IdentityClient({
    botId: BOT_ID,
    operatorId: OPERATOR_ID,
    ethPrivateKey: TEST_KEY,
    registry,
  });
  await assert.rejects(() => client.init(), /Operator status is retired/i);
});

test("init succeeds for active bot+operator with matching key", async () => {
  const registry = makeFakeRegistry({ operator: activeOperator, bot: activeBot });
  const client = new IdentityClient({
    botId: BOT_ID,
    operatorId: OPERATOR_ID,
    ethPrivateKey: TEST_KEY,
    registry,
    eip712Domain: DOMAIN,
  });
  await client.init();
});

test("verifyMessage rejects when operator is retired", async () => {
  const account = privateKeyToAccount(TEST_KEY);
  const envelope = {
    from: BOT_ID,
    from_id: BOT_ID,
    operator_id: OPERATOR_ID,
    type: "coordination",
    timestamp: new Date().toISOString(),
    message_id: "msg-1",
    body: { text: "hello" },
  };
  const { signature } = await signEnvelope(account, envelope, DOMAIN);

  const registry = makeFakeRegistry({ operator: activeOperator, bot: activeBot });
  const client = new IdentityClient({
    botId: BOT_ID,
    operatorId: OPERATOR_ID,
    ethPrivateKey: TEST_KEY,
    registry,
    eip712Domain: DOMAIN,
  });
  await client.init();
  registry.setOperator({ ...activeOperator, status: "retired", revokedAt: 9n });

  const ok = await client.verifyMessage(envelope, signature, BOT_ID);
  assert.equal(ok, false);
});

test("signMessage works after init with domain override", async () => {
  const registry = makeFakeRegistry({ operator: activeOperator, bot: activeBot });
  const client = new IdentityClient({
    botId: BOT_ID,
    operatorId: OPERATOR_ID,
    ethPrivateKey: TEST_KEY,
    registry,
    eip712Domain: DOMAIN,
  });
  await client.init();
  const signed = await client.signMessage({
    from: BOT_ID,
    from_id: BOT_ID,
    operator_id: OPERATOR_ID,
    type: "coordination",
    timestamp: new Date().toISOString(),
    message_id: "msg-cache",
    body: { text: "cached domain" },
  });
  assert.ok(signed.signature.startsWith("0x"));
});

test("constructor throws without chainRpcUrl and registryAddress", async () => {
  const prevRpc = process.env.CHAIN_RPC_URL;
  const prevBase = process.env.BASE_SEPOLIA_RPC_URL;
  const prevReg = process.env.REGISTRY_ADDRESS;
  delete process.env.CHAIN_RPC_URL;
  delete process.env.BASE_SEPOLIA_RPC_URL;
  delete process.env.REGISTRY_ADDRESS;
  try {
    assert.throws(
      () =>
        new IdentityClient({
          botId: BOT_ID,
          operatorId: OPERATOR_ID,
          ethPrivateKey: TEST_KEY,
        }),
      /chainRpcUrl \+ registryAddress/i,
    );
    assert.throws(
      () =>
        new IdentityClient({
          botId: BOT_ID,
          operatorId: OPERATOR_ID,
          ethPrivateKey: TEST_KEY,
          chainRpcUrl: "http://127.0.0.1:8545",
          registryAddress: "0xgg" as Address,
        }),
      /0x \+ 40 hex/i,
    );
  } finally {
    if (prevRpc !== undefined) process.env.CHAIN_RPC_URL = prevRpc;
    else delete process.env.CHAIN_RPC_URL;
    if (prevBase !== undefined) process.env.BASE_SEPOLIA_RPC_URL = prevBase;
    else delete process.env.BASE_SEPOLIA_RPC_URL;
    if (prevReg !== undefined) process.env.REGISTRY_ADDRESS = prevReg;
    else delete process.env.REGISTRY_ADDRESS;
  }
});

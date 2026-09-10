import assert from "node:assert/strict";
import test from "node:test";
import type { Address, Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { keccak256, toBytes } from "viem";
import { signEnvelope } from "../src/eip712.js";
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

function opId(): Hex {
  return keccak256(toBytes(OPERATOR_ID)) as Hex;
}

test("verifyMessage accepts valid signature from active peer", async () => {
  const account = privateKeyToAccount(TEST_KEY);
  const domain = { chainId: 31337, registryAddress: REGISTRY };
  const envelope = {
    from: BOT_ID,
    from_id: BOT_ID,
    operator_id: OPERATOR_ID,
    type: "coordination",
    timestamp: new Date().toISOString(),
    message_id: "msg-ok",
    body: { text: "hello" },
  };
  const { signature } = await signEnvelope(account, envelope, domain);

  const operator: OnchainOperator = {
    owner: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
    status: "active",
    registeredAt: 1n,
    revokedAt: 0n,
  };
  const bot: OnchainBot = {
    botId: BOT_ID,
    operatorId: opId(),
    botKey: account.address,
    status: "active",
    registeredAt: 1n,
    revokedAt: 0n,
  };
  const registry: IdentityRegistryReader = {
    async getBotByLabel() {
      return bot;
    },
    async getOperatorByLabel() {
      return operator;
    },
    async getOperatorById() {
      return operator;
    },
    async getEip712Domain() {
      return domain;
    },
  };

  const client = new IdentityClient({
    botId: BOT_ID,
    operatorId: OPERATOR_ID,
    ethPrivateKey: TEST_KEY,
    registry,
    eip712Domain: domain,
  });
  await client.init();
  assert.equal(await client.verifyMessage(envelope, signature, BOT_ID), true);
});

test("verifyMessage rejects when envelope.operator_id does not match on-chain operator", async () => {
  const account = privateKeyToAccount(TEST_KEY);
  const domain = { chainId: 31337, registryAddress: REGISTRY };
  const envelope = {
    from: BOT_ID,
    from_id: BOT_ID,
    operator_id: "org.openclaw.liar",
    type: "coordination",
    timestamp: new Date().toISOString(),
    message_id: "msg-liar",
    body: { text: "hello" },
  };
  const { signature } = await signEnvelope(account, envelope, domain);

  const operator: OnchainOperator = {
    owner: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
    status: "active",
    registeredAt: 1n,
    revokedAt: 0n,
  };
  const bot: OnchainBot = {
    botId: BOT_ID,
    operatorId: opId(),
    botKey: account.address,
    status: "active",
    registeredAt: 1n,
    revokedAt: 0n,
  };
  const registry: IdentityRegistryReader = {
    async getBotByLabel() {
      return bot;
    },
    async getOperatorByLabel() {
      return operator;
    },
    async getOperatorById() {
      return operator;
    },
    async getEip712Domain() {
      return domain;
    },
  };

  const client = new IdentityClient({
    botId: BOT_ID,
    operatorId: OPERATOR_ID,
    ethPrivateKey: TEST_KEY,
    registry,
    eip712Domain: domain,
  });
  await client.init();
  assert.equal(await client.verifyMessage(envelope, signature, BOT_ID), false);
});

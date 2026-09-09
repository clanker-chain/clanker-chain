import { expect, test } from "bun:test";
import {
  IdentityClient,
  registryLabelToId,
  type IdentityRegistryReader,
  type OnchainBot,
  type OnchainOperator,
} from "@clanker-chain/identity-node-client";
import {
  attachSignature,
  buildCoordinationEnvelope,
  parseSignedEnvelope,
} from "../src/wire-format.js";

const TEST_KEY =
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as const;
const TEST_ADDRESS = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const REGISTRY = "0x1234567890123456789012345678901234567890" as const;

test("parseSignedEnvelope rejects legacy truncated payloads", () => {
  expect(
    parseSignedEnvelope({
      from: "openclaw.france.prod-1",
      to: "openclaw.tooter.prod-1",
      timestamp: new Date().toISOString(),
      body: "hello",
      signature: "0x" + "11".repeat(65),
      signature_scheme: "eip712-secp256k1",
    }),
  ).toBeNull();
});

test("sign → wire → parse → verify round trip", async () => {
  const botId = "openclaw.france.prod-1";
  const operatorId = "org.openclaw.pat";
  const domain = { chainId: 31337, registryAddress: REGISTRY };
  const operatorIdBytes = registryLabelToId(operatorId);

  const envelope = buildCoordinationEnvelope({
    botId,
    operatorId,
    to: "openclaw.tooter.prod-1",
    text: "ping",
    messageId: "msg-roundtrip",
    timestamp: "2026-05-23T12:00:00.000Z",
  });

  const operator: OnchainOperator = {
    owner: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
    status: "active",
    registeredAt: 1n,
    revokedAt: 0n,
  };
  const bot: OnchainBot = {
    botId,
    operatorId: operatorIdBytes,
    botKey: TEST_ADDRESS,
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
    botId,
    operatorId,
    ethPrivateKey: TEST_KEY,
    eip712Domain: domain,
    registry,
  });

  const { signature, signature_scheme } = await client.signMessage(envelope);
  const wire = attachSignature(envelope, signature, signature_scheme);
  const parsed = parseSignedEnvelope(wire);

  expect(parsed).not.toBeNull();
  expect(parsed!.envelope.body).toEqual({ text: "ping" });
  expect(parsed!.envelope.message_id).toBe("msg-roundtrip");

  const ok = await client.verifyMessage(
    parsed!.envelope,
    parsed!.signature as `0x${string}`,
    botId,
  );
  expect(ok).toBe(true);
});

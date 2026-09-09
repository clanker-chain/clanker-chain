import { expect, test } from "bun:test";
import { IdentityClient } from "@clanker-chain/identity-node-client";
import { attachSignature, buildCoordinationEnvelope } from "../src/wire-format.js";

const TEST_KEY =
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as const;
const TEST_ADDRESS = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const REGISTRY = "0x1234567890123456789012345678901234567890" as const;

test("buildCoordinationEnvelope sets canonical to_id", () => {
  const envelope = buildCoordinationEnvelope({
    botId: "openclaw.france.prod-1",
    operatorId: "org.openclaw.pat",
    to: "openclaw.tooter.prod-1",
    text: "ping",
    messageId: "msg-1",
    timestamp: "2026-05-24T12:00:00.000Z",
  });

  expect(envelope.to_id).toBe("openclaw.tooter.prod-1");
  expect(envelope.body).toEqual({ text: "ping" });
});

test("sign → attachSignature produces wire payload", async () => {
  const botId = "openclaw.france.prod-1";
  const operatorId = "org.openclaw.pat";

  const envelope = buildCoordinationEnvelope({
    botId,
    operatorId,
    to: "openclaw.tooter.prod-1",
    text: "ping",
    messageId: "msg-roundtrip",
    timestamp: "2026-05-24T12:00:00.000Z",
  });

  const client = new IdentityClient({
    botId,
    operatorId,
    ethPrivateKey: TEST_KEY,
    eip712Domain: { chainId: 31337, registryAddress: REGISTRY },
    chainRpcUrl: "http://127.0.0.1:1",
    registryAddress: REGISTRY,
  });

  const { signature, signature_scheme } = await client.signMessage(envelope);
  const wire = attachSignature(envelope, signature, signature_scheme);

  expect(wire.signature).toBe(signature);
  expect(wire.signature_scheme).toBe(signature_scheme);
  expect(wire.message_id).toBe("msg-roundtrip");
});

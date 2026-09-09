import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import {
  canonicalJson,
  signEnvelope,
  verifyEnvelope,
  CLANKER_MESSAGE_SIGNATURE_SCHEME,
} from "../src/eip712.js";
import type { IdentityMessageEnvelope } from "../src/types.js";

const domain = {
  chainId: 31337,
  registryAddress: "0x5FbDB2315678afecb367f032d93F642f64180aa3" as const,
};

const sampleEnvelope: IdentityMessageEnvelope = {
  from: "france-bot",
  from_id: "openclaw.france.prod-1",
  operator_id: "org.openclaw.pat",
  to: "tooter-bot",
  to_id: "openclaw.tooter.prod-1",
  type: "coordination",
  subtype: "task-claim",
  timestamp: "2026-05-23T12:00:00.000Z",
  message_id: "msg-1",
  body: { action: "claim_task", task_id: "task-123" },
};

describe("EIP-712 message signing", () => {
  it("round-trips sign and verify", async () => {
    const account = privateKeyToAccount(generatePrivateKey());
    const { signature, signature_scheme } = await signEnvelope(account, sampleEnvelope, domain);
    assert.equal(signature_scheme, CLANKER_MESSAGE_SIGNATURE_SCHEME);
    assert.match(signature, /^0x[0-9a-fA-F]+$/);
    const ok = await verifyEnvelope(sampleEnvelope, signature, account.address, domain);
    assert.equal(ok, true);
  });

  it("treats omitted optional fields as empty strings", async () => {
    const account = privateKeyToAccount(generatePrivateKey());
    const minimal: IdentityMessageEnvelope = {
      from: "a",
      from_id: "openclaw.a.prod-1",
      operator_id: "org.openclaw.pat",
      type: "status",
      timestamp: "2026-05-23T12:00:00.000Z",
      message_id: "m2",
      body: {},
    };
    const { signature } = await signEnvelope(account, minimal, domain);
    assert.equal(await verifyEnvelope(minimal, signature, account.address, domain), true);
  });

  it("rejects wrong signing key", async () => {
    const account = privateKeyToAccount(generatePrivateKey());
    const other = privateKeyToAccount(generatePrivateKey());
    const { signature } = await signEnvelope(account, sampleEnvelope, domain);
    assert.equal(await verifyEnvelope(sampleEnvelope, signature, other.address, domain), false);
  });

  it("canonicalizes body key order for interop", async () => {
    const account = privateKeyToAccount(generatePrivateKey());
    const envA: IdentityMessageEnvelope = {
      ...sampleEnvelope,
      body: { task_id: "task-123", action: "claim_task" },
    };
    const envB: IdentityMessageEnvelope = {
      ...sampleEnvelope,
      body: { action: "claim_task", task_id: "task-123" },
    };
    const sigA = (await signEnvelope(account, envA, domain)).signature;
    assert.equal(await verifyEnvelope(envB, sigA, account.address, domain), true);
  });

  it("omits undefined object properties like JSON.stringify", () => {
    assert.equal(
      canonicalJson({ action: "ping", optional: undefined, task_id: "t1" }),
      canonicalJson({ action: "ping", task_id: "t1" }),
    );
    assert.doesNotMatch(canonicalJson({ foo: undefined, bar: 1 }), /undefined/);
  });

  it("verifies after wire JSON drops undefined body properties", async () => {
    const account = privateKeyToAccount(generatePrivateKey());
    const signedEnvelope: IdentityMessageEnvelope = {
      ...sampleEnvelope,
      body: { action: "claim_task", task_id: "task-123", optional: undefined },
    };
    const { signature } = await signEnvelope(account, signedEnvelope, domain);
    const wireBody = JSON.parse(JSON.stringify(signedEnvelope.body)) as Record<string, unknown>;
    const afterWire: IdentityMessageEnvelope = { ...signedEnvelope, body: wireBody };
    assert.equal(await verifyEnvelope(afterWire, signature, account.address, domain), true);
  });
});

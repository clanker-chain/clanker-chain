import { expect, test } from "bun:test";
import { loadLedger, getLedgerSnapshot } from "../src/ledger";
import { isTimestampRecent, validateMintOperator } from "../src/validation";
import { verifyEd25519 } from "../src/crypto";
import * as ed25519 from "@noble/ed25519";

test("ledger loads with operators, bots, and operations", async () => {
  const ledger = await loadLedger();
  expect(ledger).toHaveProperty("operators");
  expect(ledger).toHaveProperty("bots");
  expect(ledger).toHaveProperty("operations");
  expect(Array.isArray(ledger.operations)).toBe(true);
});

test("ledger snapshot is a clone", async () => {
  const ledger = await getLedgerSnapshot();
  const copy = await getLedgerSnapshot();
  const operatorIds = Object.keys(ledger.operators);
  if (operatorIds.length > 0) {
    const id = operatorIds[0];
    copy.operators[id].display_name = "mutated";
    expect(ledger.operators[id].display_name).not.toBe("mutated");
  }
});

test("isTimestampRecent accepts now and rejects old timestamp", () => {
  expect(isTimestampRecent(new Date().toISOString())).toBe(true);
  expect(isTimestampRecent("2020-01-01T00:00:00.000Z")).toBe(false);
});

test("validateMintOperator accepts valid body with recent timestamp", () => {
  const timestamp = new Date().toISOString();
  const public_key = Buffer.alloc(32).fill(1).toString("base64");
  const message = `mint-operator:org.openclaw.test:${public_key}:${timestamp}`;
  const body = {
    operator_id: "org.openclaw.test",
    display_name: "Test",
    public_key,
    signature: Buffer.alloc(64).fill(2).toString("base64"),
    message,
  };
  const result = validateMintOperator(body);
  expect(result.operator_id).toBe("org.openclaw.test");
  expect(result.message).toBe(message);
});

test("validateMintOperator rejects message with old timestamp", () => {
  const timestamp = "2020-01-01T00:00:00.000Z";
  const public_key = Buffer.alloc(32).fill(1).toString("base64");
  const message = `mint-operator:org.openclaw.test:${public_key}:${timestamp}`;
  const body = {
    operator_id: "org.openclaw.test",
    public_key,
    signature: Buffer.alloc(64).fill(2).toString("base64"),
    message,
  };
  expect(() => validateMintOperator(body)).toThrow("timestamp");
});

test("verifyEd25519 verifies valid signature", async () => {
  const priv = ed25519.utils.randomPrivateKey();
  const pub = await ed25519.getPublicKeyAsync(priv);
  const message = "hello";
  const sig = await ed25519.signAsync(new TextEncoder().encode(message), priv);
  const ok = await verifyEd25519(
    message,
    Buffer.from(sig).toString("base64"),
    Buffer.from(pub).toString("base64"),
  );
  expect(ok).toBe(true);
});

test("verifyEd25519 rejects invalid signature", async () => {
  const priv = ed25519.utils.randomPrivateKey();
  const pub = await ed25519.getPublicKeyAsync(priv);
  const ok = await verifyEd25519(
    "hello",
    Buffer.alloc(64).fill(0).toString("base64"),
    Buffer.from(pub).toString("base64"),
  );
  expect(ok).toBe(false);
});

test("POST /v1/bots accepts mint-bot-token payload and GET /v1/bots returns bot record", async () => {
  // Arrange: create an operator with a real keypair so we can sign a mint-bot payload.
  const operatorPriv = ed25519.utils.randomPrivateKey();
  const operatorPub = await ed25519.getPublicKeyAsync(operatorPriv);
  const operatorPublicKeyB64 = Buffer.from(operatorPub).toString("base64");
  const operatorId = "org.openclaw.test-operator";

  const ledger = await getLedgerSnapshot();
  ledger.operators[operatorId] = {
    operator_id: operatorId,
    display_name: "Test Operator",
    public_keys: [
      {
        key_id: `${operatorId}-test-key`,
        algorithm: "ed25519",
        public_key: operatorPublicKeyB64,
        created: new Date().toISOString(),
        status: "active",
      },
    ],
    status: "active",
    created: new Date().toISOString(),
    updated: new Date().toISOString(),
  };

  // Persist the operator into the real ledger used by the server.
  await loadLedger();

  const botId = "openclaw.test-bot";
  const botPriv = ed25519.utils.randomPrivateKey();
  const botPub = await ed25519.getPublicKeyAsync(botPriv);
  const botPublicKeyB64 = Buffer.from(botPub).toString("base64");
  const timestamp = new Date().toISOString();
  const message = `mint-bot:${botId}:${operatorId}:${botPublicKeyB64}:${timestamp}`;
  const msgBytes = new TextEncoder().encode(message);
  const operatorSig = await ed25519.signAsync(msgBytes, operatorPriv);
  const operatorSignatureB64 = Buffer.from(operatorSig).toString("base64");

  const payload = {
    bot_id: botId,
    operator_id: operatorId,
    display_name: "Test Bot",
    bot_public_key: botPublicKeyB64,
    operator_signature: operatorSignatureB64,
    message,
  };

  const baseUrl = "http://localhost:8080";

  // Act: POST the mint-bot payload to /v1/bots.
  const postRes = await fetch(`${baseUrl}/v1/bots`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });

  expect(postRes.status).toBe(201);
  const createdBot = (await postRes.json()) as { bot_id: string };
  expect(createdBot.bot_id).toBe(botId);

  // Act: GET the bot back.
  const getRes = await fetch(`${baseUrl}/v1/bots/${encodeURIComponent(botId)}`);
  expect(getRes.status).toBe(200);
  const fetchedBot = (await getRes.json()) as { bot_id: string; operator_id: string };
  expect(fetchedBot.bot_id).toBe(botId);
  expect(fetchedBot.operator_id).toBe(operatorId);
});


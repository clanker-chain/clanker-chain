import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import { privateKeyToAccount } from "viem/accounts";
import { signEnvelope } from "../src/eip712.js";
import { IdentityClient } from "../src/index.js";

const TEST_KEY =
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as const;
const REGISTRY = "0x1234567890123456789012345678901234567890" as const;
const BOT_ID = "openclaw.test.bot";
const OPERATOR_ID = "org.openclaw.test";

function startMockIdentity(routes: Record<string, () => { status?: number; body: unknown }>): Promise<{
  baseUrl: string;
  close: () => Promise<void>;
}> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const pathname = new URL(req.url ?? "/", "http://127.0.0.1").pathname;
      const handler = routes[pathname];
      if (!handler) {
        res.writeHead(404, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "not_found" }));
        return;
      }
      const { status = 200, body } = handler();
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    });
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        reject(new Error("failed to bind mock identity server"));
        return;
      }
      resolve({
        baseUrl: `http://127.0.0.1:${addr.port}`,
        close: () =>
          new Promise((done, err) => {
            server.close((e) => (e ? err(e) : done()));
          }),
      });
    });
  });
}

const activeBot = {
  bot_id: BOT_ID,
  operator_id: OPERATOR_ID,
  status: "active",
  created: new Date().toISOString(),
  updated: new Date().toISOString(),
  public_keys: [
    {
      key_id: "k1",
      algorithm: "secp256k1-eth",
      public_key: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
      created: new Date().toISOString(),
      status: "active",
    },
  ],
};

const activeOperator = {
  operator_id: OPERATOR_ID,
  status: "active",
  created: new Date().toISOString(),
  updated: new Date().toISOString(),
};

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
  const { signature } = await signEnvelope(account, envelope, {
    chainId: 31337,
    registryAddress: REGISTRY,
  });

  let operatorStatus: "active" | "retired" = "active";
  const mock = await startMockIdentity({
    "/health": () => ({
      body: {
        ok: true,
        mode: "evm",
        chainId: 31337,
        registryAddress: REGISTRY,
        chainOk: true,
      },
    }),
    [`/v1/bots/${BOT_ID}`]: () => ({ body: activeBot }),
    [`/v1/operators/${OPERATOR_ID}`]: () => ({
      body: { ...activeOperator, status: operatorStatus },
    }),
  });

  const client = new IdentityClient({
    botId: BOT_ID,
    operatorId: OPERATOR_ID,
    identityServiceUrl: mock.baseUrl,
    ethPrivateKey: TEST_KEY,
  });
  await client.init();
  operatorStatus = "retired";

  const ok = await client.verifyMessage(envelope, signature, BOT_ID);
  assert.equal(ok, false);
  await mock.close();
});

test("signMessage uses domain cached at init without re-checking health", async () => {
  let healthCalls = 0;
  const mock = await startMockIdentity({
    "/health": () => {
      healthCalls += 1;
      return {
        body: {
          ok: healthCalls === 1,
          mode: "evm",
          chainId: 31337,
          registryAddress: REGISTRY,
          chainOk: healthCalls === 1,
        },
      };
    },
    [`/v1/operators/${OPERATOR_ID}`]: () => ({ body: activeOperator }),
    [`/v1/bots/${BOT_ID}`]: () => ({ body: activeBot }),
  });

  const client = new IdentityClient({
    botId: BOT_ID,
    operatorId: OPERATOR_ID,
    identityServiceUrl: mock.baseUrl,
    ethPrivateKey: TEST_KEY,
  });
  await client.init();
  await client.signMessage({
    from: BOT_ID,
    from_id: BOT_ID,
    operator_id: OPERATOR_ID,
    type: "coordination",
    timestamp: new Date().toISOString(),
    message_id: "msg-cache",
    body: { text: "cached domain" },
  });

  assert.equal(healthCalls, 1);
  await mock.close();
});

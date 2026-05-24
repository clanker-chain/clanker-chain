import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import { IdentityClient } from "../src/index.js";

const TEST_KEY =
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as const;
const REGISTRY = "0x1234567890123456789012345678901234567890";

type RouteHandler = (req: http.IncomingMessage) => { status?: number; body: unknown };

function startMockIdentity(routes: Record<string, RouteHandler>): Promise<{
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
      const { status = 200, body } = handler(req);
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

test("init fails when identity service health.ok is false", async () => {
  const mock = await startMockIdentity({
    "/health": () => ({
      body: {
        ok: false,
        mode: "evm",
        chainId: 31337,
        registryAddress: REGISTRY,
        chainOk: false,
      },
    }),
  });

  const client = new IdentityClient({
    botId: "openclaw.test.bot",
    operatorId: "org.openclaw.test",
    identityServiceUrl: mock.baseUrl,
    ethPrivateKey: TEST_KEY,
  });

  await assert.rejects(
    () => client.init(),
    /degraded/i,
  );
  await mock.close();
});

test("init fails when bot status is retired", async () => {
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
    "/v1/operators/org.openclaw.test": () => ({
      body: {
        operator_id: "org.openclaw.test",
        status: "active",
        created: new Date().toISOString(),
        updated: new Date().toISOString(),
      },
    }),
    "/v1/bots/openclaw.test.bot": () => ({
      body: {
        bot_id: "openclaw.test.bot",
        operator_id: "org.openclaw.test",
        status: "retired",
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
      },
    }),
  });

  const client = new IdentityClient({
    botId: "openclaw.test.bot",
    operatorId: "org.openclaw.test",
    identityServiceUrl: mock.baseUrl,
    ethPrivateKey: TEST_KEY,
  });

  await assert.rejects(
    () => client.init(),
    /Bot status is retired/i,
  );
  await mock.close();
});

test("init fails when health.ok is true but chainOk is false", async () => {
  const mock = await startMockIdentity({
    "/health": () => ({
      body: {
        ok: true,
        mode: "evm",
        chainId: 31337,
        registryAddress: REGISTRY,
        chainOk: false,
      },
    }),
  });

  const client = new IdentityClient({
    botId: "openclaw.test.bot",
    operatorId: "org.openclaw.test",
    identityServiceUrl: mock.baseUrl,
    ethPrivateKey: TEST_KEY,
  });

  await assert.rejects(
    () => client.init(),
    /degraded/i,
  );
  await mock.close();
});

test("init fails when operator status is retired", async () => {
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
    "/v1/operators/org.openclaw.test": () => ({
      body: {
        operator_id: "org.openclaw.test",
        status: "retired",
        created: new Date().toISOString(),
        updated: new Date().toISOString(),
      },
    }),
  });

  const client = new IdentityClient({
    botId: "openclaw.test.bot",
    operatorId: "org.openclaw.test",
    identityServiceUrl: mock.baseUrl,
    ethPrivateKey: TEST_KEY,
  });

  await assert.rejects(
    () => client.init(),
    /Operator status is retired/i,
  );
  await mock.close();
});

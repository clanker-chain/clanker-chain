import { expect, test } from "bun:test";
import { getDefaultLedgerPath } from "../src/ledger";
import { createFetchHandler } from "../src/routes";
import type { IdentityBackend, IdentityBackendHealth } from "../src/backend";
import type { BotRecord, IdentityLedger, OperatorRecord } from "../src/ledger";

class MockBackend implements IdentityBackend {
  constructor(
    private healthState: IdentityBackendHealth,
    private operators: Record<string, OperatorRecord> = {},
    private bots: Record<string, BotRecord> = {},
  ) {}

  async getBot(botId: string): Promise<BotRecord | undefined> {
    return this.bots[botId];
  }

  async getOperator(operatorId: string): Promise<OperatorRecord | undefined> {
    return this.operators[operatorId];
  }

  async getLedgerSnapshot(): Promise<IdentityLedger> {
    return {
      version: 1,
      created: new Date().toISOString(),
      updated: new Date().toISOString(),
      operators: this.operators,
      bots: this.bots,
      operations: [],
    };
  }

  async health(): Promise<IdentityBackendHealth> {
    return this.healthState;
  }
}

test("getDefaultLedgerPath returns a path ending in bot-identity-ledger.json", () => {
  const p = getDefaultLedgerPath();
  expect(p.endsWith("bot-identity-ledger.json")).toBe(true);
});

test("GET /health returns backend health", async () => {
  const backend = new MockBackend({
    ok: true,
    mode: "evm",
    chainId: 31337,
    registryAddress: "0xabc",
    chainOk: true,
  });
  const fetch = createFetchHandler(backend);
  const res = await fetch(new Request("http://localhost/health"));
  expect(res.status).toBe(200);
  const body = (await res.json()) as IdentityBackendHealth;
  expect(body.ok).toBe(true);
  expect(body.chainId).toBe(31337);
});

test("GET /health ok false when chain unreachable", async () => {
  const backend = new MockBackend({ ok: false, mode: "evm", chainOk: false });
  const fetch = createFetchHandler(backend);
  const res = await fetch(new Request("http://localhost/health"));
  const body = (await res.json()) as IdentityBackendHealth;
  expect(body.ok).toBe(false);
});

test("GET /v1/bots/:id returns bot or 404", async () => {
  const bot: BotRecord = {
    bot_id: "openclaw.test.bot",
    operator_id: "org.openclaw.pat",
    status: "active",
    created: new Date().toISOString(),
    updated: new Date().toISOString(),
  };
  const backend = new MockBackend({ ok: true, mode: "evm" }, {}, { [bot.bot_id]: bot });
  const fetch = createFetchHandler(backend);

  const hit = await fetch(new Request("http://localhost/v1/bots/openclaw.test.bot"));
  expect(hit.status).toBe(200);
  expect(((await hit.json()) as BotRecord).bot_id).toBe(bot.bot_id);

  const miss = await fetch(new Request("http://localhost/v1/bots/missing"));
  expect(miss.status).toBe(404);
});

test("GET /v1/operators/:id returns operator or 404", async () => {
  const op: OperatorRecord = {
    operator_id: "org.openclaw.pat",
    status: "active",
    created: new Date().toISOString(),
    updated: new Date().toISOString(),
  };
  const backend = new MockBackend({ ok: true, mode: "evm" }, { [op.operator_id]: op });
  const fetch = createFetchHandler(backend);

  const hit = await fetch(new Request("http://localhost/v1/operators/org.openclaw.pat"));
  expect(hit.status).toBe(200);

  const miss = await fetch(new Request("http://localhost/v1/operators/nope"));
  expect(miss.status).toBe(404);
});

test("POST /v1/bots returns 404 (read-only API)", async () => {
  const backend = new MockBackend({ ok: true, mode: "evm" });
  const fetch = createFetchHandler(backend);
  const res = await fetch(new Request("http://localhost/v1/bots", { method: "POST" }));
  expect(res.status).toBe(404);
});

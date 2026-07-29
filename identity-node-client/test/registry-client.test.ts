import assert from "node:assert/strict";
import test from "node:test";
import type { Address, Hex, PublicClient } from "viem";
import { keccak256, toBytes } from "viem";
import { RegistryClient } from "../src/registry-client.js";

const REGISTRY = "0x1234567890123456789012345678901234567890" as Address;
const BOT_LABEL = "openclaw.test.bot";
const OP_LABEL = "org.openclaw.test";
const BOT_ID = keccak256(toBytes(BOT_LABEL)) as Hex;
const OP_ID = keccak256(toBytes(OP_LABEL)) as Hex;
const BOT_KEY = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as Address;
const OWNER = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266" as Address;

type BotsRow = readonly [Hex, Address, bigint, bigint];
type OperatorsRow = readonly [Address, bigint, bigint];

function makeMockClient(state: {
  chainId?: number;
  bots?: Map<string, BotsRow>;
  operators?: Map<string, OperatorsRow>;
}): PublicClient & {
  readCalls: number;
  setBot: (id: Hex, row: BotsRow | null) => void;
  setOperator: (id: Hex, row: OperatorsRow | null) => void;
} {
  const bots = state.bots ?? new Map<string, BotsRow>();
  const operators = state.operators ?? new Map<string, OperatorsRow>();
  let readCalls = 0;
  const client = {
    get readCalls() {
      return readCalls;
    },
    setBot(id: Hex, row: BotsRow | null) {
      if (row === null) bots.delete(id.toLowerCase());
      else bots.set(id.toLowerCase(), row);
    },
    setOperator(id: Hex, row: OperatorsRow | null) {
      if (row === null) operators.delete(id.toLowerCase());
      else operators.set(id.toLowerCase(), row);
    },
    async getChainId() {
      return state.chainId ?? 31337;
    },
    async readContract(args: {
      functionName: string;
      args: readonly unknown[];
    }) {
      readCalls += 1;
      if (args.functionName === "bots") {
        const id = String(args.args[0]).toLowerCase();
        return bots.get(id) ?? ([
          "0x0000000000000000000000000000000000000000000000000000000000000000",
          "0x0000000000000000000000000000000000000000",
          0n,
          0n,
        ] as BotsRow);
      }
      if (args.functionName === "operators") {
        const id = String(args.args[0]).toLowerCase();
        return operators.get(id) ?? ([
          "0x0000000000000000000000000000000000000000",
          0n,
          0n,
        ] as OperatorsRow);
      }
      throw new Error(`unexpected function ${args.functionName}`);
    },
  };
  return client as unknown as PublicClient & {
    readCalls: number;
    setBot: (id: Hex, row: BotsRow | null) => void;
    setOperator: (id: Hex, row: OperatorsRow | null) => void;
  };
}

test("getBotByLabel decodes active bot tuple", async () => {
  const pc = makeMockClient({
    bots: new Map([[BOT_ID.toLowerCase(), [OP_ID, BOT_KEY, 1_700_000_000n, 0n]]]),
  });
  const client = new RegistryClient({
    rpcUrl: "http://127.0.0.1:1",
    registryAddress: REGISTRY,
    publicClient: pc,
    cacheTtlMs: 0,
  });
  const bot = await client.getBotByLabel(BOT_LABEL);
  assert.ok(bot);
  assert.equal(bot!.botId, BOT_LABEL);
  assert.equal(bot!.operatorId.toLowerCase(), OP_ID.toLowerCase());
  assert.equal(bot!.botKey.toLowerCase(), BOT_KEY.toLowerCase());
  assert.equal(bot!.status, "active");
  assert.equal(bot!.revokedAt, 0n);
});

test("getBotByLabel maps revokedAt to retired", async () => {
  const pc = makeMockClient({
    bots: new Map([
      [BOT_ID.toLowerCase(), [OP_ID, BOT_KEY, 1_700_000_000n, 1_700_000_100n]],
    ]),
  });
  const client = new RegistryClient({
    rpcUrl: "http://127.0.0.1:1",
    registryAddress: REGISTRY,
    publicClient: pc,
    cacheTtlMs: 0,
  });
  const bot = await client.getBotByLabel(BOT_LABEL);
  assert.equal(bot!.status, "retired");
});

test("getBotByLabel returns null for empty slot", async () => {
  const pc = makeMockClient({});
  const client = new RegistryClient({
    rpcUrl: "http://127.0.0.1:1",
    registryAddress: REGISTRY,
    publicClient: pc,
    cacheTtlMs: 0,
  });
  assert.equal(await client.getBotByLabel(BOT_LABEL), null);
});

test("getOperatorByLabel / getOperatorById decode active operator", async () => {
  const pc = makeMockClient({
    operators: new Map([[OP_ID.toLowerCase(), [OWNER, 1_700_000_000n, 0n]]]),
  });
  const client = new RegistryClient({
    rpcUrl: "http://127.0.0.1:1",
    registryAddress: REGISTRY,
    publicClient: pc,
    cacheTtlMs: 0,
  });
  const byLabel = await client.getOperatorByLabel(OP_LABEL);
  const byId = await client.getOperatorById(OP_ID);
  assert.equal(byLabel!.owner.toLowerCase(), OWNER.toLowerCase());
  assert.equal(byLabel!.status, "active");
  assert.equal(byId!.status, "active");
});

test("cache hit avoids second readContract within TTL", async () => {
  const pc = makeMockClient({
    bots: new Map([[BOT_ID.toLowerCase(), [OP_ID, BOT_KEY, 1n, 0n]]]),
  });
  const client = new RegistryClient({
    rpcUrl: "http://127.0.0.1:1",
    registryAddress: REGISTRY,
    publicClient: pc,
    cacheTtlMs: 60_000,
  });
  await client.getBotByLabel(BOT_LABEL);
  const afterFirst = pc.readCalls;
  await client.getBotByLabel(BOT_LABEL);
  assert.equal(pc.readCalls, afterFirst);
});

test("negative cache stores null and skips RPC within TTL", async () => {
  const pc = makeMockClient({});
  const client = new RegistryClient({
    rpcUrl: "http://127.0.0.1:1",
    registryAddress: REGISTRY,
    publicClient: pc,
    cacheTtlMs: 60_000,
  });
  assert.equal(await client.getBotByLabel(BOT_LABEL), null);
  const afterMiss = pc.readCalls;
  assert.equal(await client.getBotByLabel(BOT_LABEL), null);
  assert.equal(pc.readCalls, afterMiss);
});

test("cacheTtlMs 0 always re-reads", async () => {
  const pc = makeMockClient({
    bots: new Map([[BOT_ID.toLowerCase(), [OP_ID, BOT_KEY, 1n, 0n]]]),
  });
  const client = new RegistryClient({
    rpcUrl: "http://127.0.0.1:1",
    registryAddress: REGISTRY,
    publicClient: pc,
    cacheTtlMs: 0,
  });
  await client.getBotByLabel(BOT_LABEL);
  await client.getBotByLabel(BOT_LABEL);
  assert.equal(pc.readCalls, 2);
});

test("clearCache forces fresh read", async () => {
  const pc = makeMockClient({
    bots: new Map([[BOT_ID.toLowerCase(), [OP_ID, BOT_KEY, 1n, 0n]]]),
  });
  const client = new RegistryClient({
    rpcUrl: "http://127.0.0.1:1",
    registryAddress: REGISTRY,
    publicClient: pc,
    cacheTtlMs: 60_000,
  });
  await client.getBotByLabel(BOT_LABEL);
  client.clearCache();
  await client.getBotByLabel(BOT_LABEL);
  assert.equal(pc.readCalls, 2);
});

test("pinned chainId mismatch throws", async () => {
  const pc = makeMockClient({ chainId: 84532 });
  const client = new RegistryClient({
    rpcUrl: "http://127.0.0.1:1",
    registryAddress: REGISTRY,
    publicClient: pc,
    chainId: 31337,
    cacheTtlMs: 0,
  });
  await assert.rejects(() => client.getChainId(), /does not match pinned chainId/);
});

test("getEip712Domain uses chainId + registryAddress", async () => {
  const pc = makeMockClient({ chainId: 84532 });
  const client = new RegistryClient({
    rpcUrl: "http://127.0.0.1:1",
    registryAddress: REGISTRY,
    publicClient: pc,
    cacheTtlMs: 0,
  });
  const domain = await client.getEip712Domain();
  assert.deepEqual(domain, { chainId: 84532, registryAddress: REGISTRY });
});

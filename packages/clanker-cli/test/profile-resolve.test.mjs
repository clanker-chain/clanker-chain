import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getAddress, keccak256, toBytes } from "viem";
import {
  ANVIL_DEFAULT_PRIVATE_KEY,
  SEPOLIA_REGISTRY,
  initProfile,
  isLocalRpc,
  loadConfig,
  resolveNetwork,
  writeOperator,
} from "../lib/profile.mjs";
import {
  isAnvilDefaultKey,
  keyPointerFromSource,
  normalizePrivateKey,
  resolveOperatorKey,
} from "../lib/resolve.mjs";
import {
  findOperatorsByOwner,
  getLogsChunked,
  labelToId,
  pickOperatorLabel,
  resolvePreferredOperator,
} from "../lib/identity-query.mjs";
import { assertSafeBotLabel, writeBotKeyFiles } from "../lib/keys.mjs";

describe("isLocalRpc", () => {
  it("accepts localhost and 127.0.0.1", () => {
    assert.equal(isLocalRpc("http://127.0.0.1:8545"), true);
    assert.equal(isLocalRpc("http://localhost:8545"), true);
  });
  it("rejects public hosts", () => {
    assert.equal(isLocalRpc("https://sepolia.base.org"), false);
  });
});

describe("labelToId", () => {
  it("matches keccak256 of utf8 label", () => {
    assert.equal(labelToId("org.openclaw.pat"), keccak256(toBytes("org.openclaw.pat")));
  });
});

describe("normalizePrivateKey / Anvil detect", () => {
  it("normalizes without 0x", () => {
    const bare = ANVIL_DEFAULT_PRIVATE_KEY.slice(2);
    assert.equal(normalizePrivateKey(bare), ANVIL_DEFAULT_PRIVATE_KEY.toLowerCase());
  });
  it("detects Anvil default", () => {
    assert.equal(isAnvilDefaultKey(ANVIL_DEFAULT_PRIVATE_KEY), true);
  });
});

describe("keyPointerFromSource", () => {
  it("maps --key-file to keyFile pointer", () => {
    assert.deepEqual(keyPointerFromSource({ source: "--key-file /tmp/op.key" }), {
      type: "keyFile",
      value: "/tmp/op.key",
    });
  });
  it("maps --key and env to OPERATOR_PRIVATE_KEY", () => {
    assert.deepEqual(keyPointerFromSource({ source: "--key" }), {
      type: "env",
      value: "OPERATOR_PRIVATE_KEY",
    });
    assert.deepEqual(keyPointerFromSource({ source: "OPERATOR_PRIVATE_KEY" }), {
      type: "env",
      value: "OPERATOR_PRIVATE_KEY",
    });
  });
});

describe("profile init + resolveNetwork", () => {
  let home;
  it("writes sepolia preset", () => {
    home = mkdtempSync(join(tmpdir(), "clanker-profile-"));
    const { config } = initProfile("sepolia", { home });
    assert.equal(config.preset, "sepolia");
    assert.equal(config.registryAddress, SEPOLIA_REGISTRY);
    const loaded = loadConfig(home);
    assert.equal(typeof loaded.fromBlock, "bigint");
  });

  it("refuses overwrite without --force", () => {
    assert.throws(() => initProfile("local", { home }), /already exists/);
  });

  it("merges --rpc over profile", () => {
    const net = resolveNetwork(["--rpc", "http://127.0.0.1:8545", "--registry", SEPOLIA_REGISTRY], {
      home,
      env: {},
    });
    assert.equal(net.rpc, "http://127.0.0.1:8545");
  });

  it("cleans up", () => {
    rmSync(home, { recursive: true, force: true });
  });
});

describe("Anvil guard in resolveOperatorKey", () => {
  let home;
  const otherKey =
    "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";

  it("allows Anvil on local RPC and returns keyPointer", () => {
    home = mkdtempSync(join(tmpdir(), "clanker-guard-"));
    initProfile("local", { home, registryAddress: SEPOLIA_REGISTRY });
    const resolved = resolveOperatorKey(["--rpc", "http://127.0.0.1:8545"], {
      home,
      env: {},
    });
    assert.equal(isAnvilDefaultKey(resolved.key), true);
    assert.equal(resolved.keyPointer.type, "env");
  });

  it("refuses missing key on public RPC", () => {
    assert.throws(
      () =>
        resolveOperatorKey(["--rpc", "https://sepolia.base.org"], {
          home,
          env: {},
        }),
      /Operator private key required/,
    );
  });

  it("refuses Anvil key on public RPC even if passed", () => {
    assert.throws(
      () =>
        resolveOperatorKey(
          ["--rpc", "https://sepolia.base.org", "--key", ANVIL_DEFAULT_PRIVATE_KEY],
          { home, env: {} },
        ),
      /Refusing Anvil account #0/,
    );
  });

  it("persists keyFile pointer from --key-file", () => {
    const keyPath = join(home, "op.key");
    writeFileSync(keyPath, `${otherKey}\n`, { mode: 0o600 });
    const resolved = resolveOperatorKey(
      ["--rpc", "https://sepolia.base.org", "--key-file", keyPath],
      { home, env: {} },
    );
    assert.deepEqual(resolved.keyPointer, { type: "keyFile", value: keyPath });
  });

  it("cleans up", () => {
    rmSync(home, { recursive: true, force: true });
  });
});

describe("pickOperatorLabel", () => {
  it("picks sole active operator", () => {
    const r = pickOperatorLabel({
      operators: [
        { label: "org.a", active: true },
        { label: "org.b", active: false },
      ],
    });
    assert.equal(r.label, "org.a");
  });

  it("rejects revoked preferred", () => {
    const r = pickOperatorLabel({
      operators: [{ label: "org.a", active: false }],
      preferred: "org.a",
    });
    assert.match(r.error, /revoked/);
  });
});

describe("getLogsChunked", () => {
  it("splits wide ranges and concatenates", async () => {
    const calls = [];
    const pub = {
      async getBlockNumber() {
        return 5000n;
      },
      async getLogs(params) {
        const span = params.toBlock - params.fromBlock;
        if (span >= 2000n) throw new Error("range too wide");
        calls.push({ from: params.fromBlock, to: params.toBlock });
        return [{ blockNumber: params.fromBlock }];
      },
    };
    const logs = await getLogsChunked(
      pub,
      { address: "0xabc", fromBlock: 0n, toBlock: "latest" },
      { chunkBlocks: 2000n },
    );
    assert.equal(calls.length, 3); // 0-1999, 2000-3999, 4000-5000
    assert.equal(logs.length, 3);
    assert.equal(calls[0].to - calls[0].from, 1999n);
  });
});

describe("findOperatorsByOwner transfer + owner filter", () => {
  const oldOwner = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
  const newOwner = "0x07e8CFD171E63915A441B0E8ff9E3CC2Cd27c4B4";
  const opId = labelToId("org.openclaw.pat");
  const registry = SEPOLIA_REGISTRY;

  function mockPub(currentOwner) {
    return {
      async getBlockNumber() {
        return 100n;
      },
      async getLogs(params) {
        const eventName = params.event?.name;
        if (eventName === "OperatorRegistered") {
          if (params.args?.id) {
            return [
              {
                args: { id: opId, owner: oldOwner, label: "org.openclaw.pat" },
                transactionHash: "0xreg",
              },
            ];
          }
          if (params.args?.owner && getAddress(params.args.owner) === getAddress(oldOwner)) {
            return [
              {
                args: { id: opId, owner: oldOwner, label: "org.openclaw.pat" },
                transactionHash: "0xreg",
              },
            ];
          }
          return [];
        }
        if (eventName === "OperatorTransferred") {
          if (params.args?.newOwner && getAddress(params.args.newOwner) === getAddress(newOwner)) {
            return [
              {
                args: { id: opId, oldOwner, newOwner },
                transactionHash: "0xxfer",
              },
            ];
          }
          return [];
        }
        return [];
      },
      async readContract() {
        return [currentOwner, 1n, 0n];
      },
    };
  }

  it("lists transferred operator for new owner", async () => {
    const ops = await findOperatorsByOwner(mockPub(newOwner), {
      registry,
      owner: newOwner,
      fromBlock: 0n,
      chunkBlocks: 2000n,
    });
    assert.equal(ops.length, 1);
    assert.equal(ops[0].label, "org.openclaw.pat");
  });

  it("excludes transferred operator for old owner after storage refresh", async () => {
    const ops = await findOperatorsByOwner(mockPub(newOwner), {
      registry,
      owner: oldOwner,
      fromBlock: 0n,
      chunkBlocks: 2000n,
    });
    assert.equal(ops.length, 0);
  });
});

describe("resolvePreferredOperator", () => {
  const owner = "0x07e8CFD171E63915A441B0E8ff9E3CC2Cd27c4B4";
  const other = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";

  it("succeeds from storage without logs", async () => {
    const pub = {
      async readContract() {
        return [owner, 1n, 0n];
      },
    };
    const r = await resolvePreferredOperator(pub, {
      registry: SEPOLIA_REGISTRY,
      label: "org.openclaw.pat",
      owner,
    });
    assert.equal(r.operator.label, "org.openclaw.pat");
  });

  it("errors when storage owner mismatches", async () => {
    const pub = {
      async readContract() {
        return [other, 1n, 0n];
      },
    };
    const r = await resolvePreferredOperator(pub, {
      registry: SEPOLIA_REGISTRY,
      label: "org.openclaw.pat",
      owner,
    });
    assert.match(r.error, /owned by/);
  });

  it("errors when revoked", async () => {
    const pub = {
      async readContract() {
        return [owner, 1n, 9n];
      },
    };
    const r = await resolvePreferredOperator(pub, {
      registry: SEPOLIA_REGISTRY,
      label: "org.openclaw.pat",
      owner,
    });
    assert.match(r.error, /revoked/);
  });
});

describe("assertSafeBotLabel / writeBotKeyFiles", () => {
  it("rejects path traversal and separators", () => {
    assert.throws(() => assertSafeBotLabel("foo..bar"), /\.\./);
    assert.throws(() => assertSafeBotLabel("../../evil"), /path separators|(\.\.)/);
    assert.throws(() => assertSafeBotLabel("a/b"), /path separators/);
    assert.throws(() => assertSafeBotLabel(""), /non-empty/);
  });

  it("writes under injected dirs", () => {
    const root = mkdtempSync(join(tmpdir(), "clanker-keys-"));
    const openclaw = join(root, "openclaw");
    const clanker = join(root, "clanker");
    const key =
      "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
    const paths = writeBotKeyFiles("safe.bot.local", key, {
      openclawKeysDir: openclaw,
      clankerKeysDir: clanker,
    });
    assert.equal(existsSync(paths.openclawPath), true);
    assert.equal(existsSync(paths.clankerPath), true);
    assert.match(readFileSync(paths.openclawPath, "utf8"), /^0x59c6/);
    rmSync(root, { recursive: true, force: true });
  });
});

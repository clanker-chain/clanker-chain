import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync, unlinkSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  createPublicClient,
  createWalletClient,
  http,
  keccak256,
  toBytes,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";
import { EvmBackend } from "../src/backend-evm";
import { clankerIdentityAbi } from "../src/abi/clanker-identity";

const ANVIL_DEFAULT_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as const;
const ANVIL_KEY_1 =
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as const;
const ANVIL_KEY_2 =
  "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a" as const;

function foundryOnPath(): boolean {
  const r = Bun.spawnSync(["bash", "-lc", "command -v anvil >/dev/null && command -v forge >/dev/null"]);
  return r.exitCode === 0;
}

function skipReason(): string | null {
  if (process.env.EVM_TESTS_SKIP === "1" || process.env.EVM_TESTS_SKIP === "true") {
    return "EVM_TESTS_SKIP is set";
  }
  if (!foundryOnPath()) {
    return "anvil or forge not on PATH";
  }
  return null;
}

let skip = skipReason();

let anvilProc: ReturnType<typeof Bun.spawn> | null = null;
let rpcUrl = "";
let registry: Hex = "0x";
let deploymentBlock = 0n;
let snapshotPath = "";
let backend: EvmBackend | null = null;
const operatorLabel = "org.openclaw.evm-test";
const botLabel = "openclaw.france.prod-1";

/** On-chain mutation tests below share one backend instance; order matters. */

beforeAll(async () => {
  if (skip) return;
  const port = 20000 + Math.floor(Math.random() * 5000);
  rpcUrl = `http://127.0.0.1:${port}`;
  const chainRoot = join(import.meta.dir, "../../chain");

  anvilProc = Bun.spawn(["anvil", "--port", String(port)], {
    stdout: "ignore",
    stderr: "ignore",
  });

  for (let i = 0; i < 50; i++) {
    const ping = Bun.spawnSync(["cast", "chain-id", "--rpc-url", rpcUrl], {
      stdout: "ignore",
      stderr: "ignore",
    });
    if (ping.exitCode === 0) break;
    await new Promise((r) => setTimeout(r, 100));
  }

  const deploy = Bun.spawn(
    [
      "forge",
      "create",
      "src/ClankerIdentity.sol:ClankerIdentity",
      "--rpc-url",
      rpcUrl,
      "--private-key",
      ANVIL_DEFAULT_KEY,
      "--broadcast",
    ],
    { cwd: chainRoot, stdout: "pipe", stderr: "pipe" },
  );
  const exit = await deploy.exited;
  const out = await new Response(deploy.stdout).text();
  const err = await new Response(deploy.stderr).text();
  const combined = out + err;
  expect(exit).toBe(0);
  const m = combined.match(/Deployed to:\s*(0x[a-fA-F0-9]{40})/);
  const txm = combined.match(/Transaction hash:\s*(0x[a-fA-F0-9]{64})/);
  if (!m?.[1] || !txm?.[1]) {
    throw new Error(`forge create parse failed:\n${combined}`);
  }
  registry = m[1] as Hex;
  const receipt = Bun.spawnSync(["cast", "receipt", txm[1], "blockNumber", "--rpc-url", rpcUrl], {
    stdout: "pipe",
  });
  const bn = receipt.stdout.toString().trim();
  deploymentBlock = BigInt(bn.startsWith("0x") ? Number.parseInt(bn, 16) : bn);

  const dir = mkdtempSync(join(tmpdir(), "evm-backend-test-"));
  snapshotPath = join(dir, "ledger.json");
  writeFileSync(
    snapshotPath,
    JSON.stringify({
      version: 1,
      created: new Date().toISOString(),
      updated: new Date().toISOString(),
      operators: {},
      bots: {},
      operations: [],
    }),
  );

  const account0 = privateKeyToAccount(ANVIL_DEFAULT_KEY);
  const wallet = createWalletClient({
    account: account0,
    chain: foundry,
    transport: http(rpcUrl),
  });

  await wallet.writeContract({
    address: registry,
    abi: clankerIdentityAbi,
    functionName: "registerOperator",
    args: [operatorLabel],
  });

  const operatorIdBytes = keccak256(toBytes(operatorLabel));
  const botKeyAddr = privateKeyToAccount(ANVIL_KEY_1).address;

  await wallet.writeContract({
    address: registry,
    abi: clankerIdentityAbi,
    functionName: "registerBot",
    args: [operatorIdBytes as Hex, botLabel, botKeyAddr],
  });

  backend = new EvmBackend({
    rpcUrl,
    registry,
    deploymentBlock,
    snapshotPath,
    pollMs: 100,
  });
  await backend.start();
});

afterAll(async () => {
  await backend?.stop();
  if (anvilProc) {
    anvilProc.kill();
    await anvilProc.exited;
  }
});

test("EvmBackend indexes ClankerIdentity and tracks rotateBotKey", async () => {
  if (skip) {
    console.log(`SKIP backend-evm: ${skip}`);
    return;
  }
  expect(backend).not.toBeNull();

  const op = await backend!.getOperator(operatorLabel);
  expect(op?.operator_id).toBe(operatorLabel);
  expect(op?.public_keys?.[0]?.algorithm).toBe("secp256k1-eth");

  let bot = await backend!.getBot(botLabel);
  expect(bot?.bot_id).toBe(botLabel);
  expect(bot?.operator_id).toBe(operatorLabel);
  expect(bot?.public_keys?.[0]?.algorithm).toBe("secp256k1-eth");
  const key1 = bot?.public_keys?.[0]?.public_key?.toLowerCase();
  expect(key1).toBe(privateKeyToAccount(ANVIL_KEY_1).address.toLowerCase());

  const newKey = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC" as Address;
  const account0 = privateKeyToAccount(ANVIL_DEFAULT_KEY);
  const wallet = createWalletClient({
    account: account0,
    chain: foundry,
    transport: http(rpcUrl),
  });
  const botIdBytes = keccak256(toBytes(botLabel)) as Hex;

  const pc = createPublicClient({ chain: foundry, transport: http(rpcUrl) });
  const rotateHash = await wallet.writeContract({
    address: registry,
    abi: clankerIdentityAbi,
    functionName: "rotateBotKey",
    args: [botIdBytes, newKey],
  });
  await pc.waitForTransactionReceipt({ hash: rotateHash });
  const onChain = await pc.readContract({
    address: registry,
    abi: clankerIdentityAbi,
    functionName: "bots",
    args: [botIdBytes],
  });
  const onChainBotKey = (onChain as readonly [Hex, Address, bigint, bigint])[1];
  expect(onChainBotKey.toLowerCase()).toBe(newKey.toLowerCase());

  await backend!.syncFromChain();
  bot = await backend!.getBot(botLabel);
  expect(bot?.public_keys?.[0]?.public_key?.toLowerCase()).toBe(newKey.toLowerCase());
});

test("persistSnapshot skips disk write when only chain head advances", async () => {
  if (skip) return;
  expect(backend).not.toBeNull();

  await backend!.syncFromChain();
  const first = JSON.parse(await Bun.file(snapshotPath).text()) as {
    updated: string;
    created: string;
    meta?: { lastIndexedBlock?: string };
  };

  await new Promise((r) => setTimeout(r, 50));
  await backend!.syncFromChain();
  const second = JSON.parse(await Bun.file(snapshotPath).text()) as {
    updated: string;
    created: string;
    meta?: { lastIndexedBlock?: string };
  };

  expect(second.updated).toBe(first.updated);
  expect(second.created).toBe(first.created);
});

test("EvmBackend clamps snapshot cursor when ahead of chain head", async () => {
  if (skip) return;
  expect(backend).not.toBeNull();
  const healthBefore = await backend!.health();
  const head = BigInt(healthBefore.lastBlock ?? "0");

  const snap = JSON.parse(await Bun.file(snapshotPath).text()) as {
    meta?: { lastIndexedBlock?: string; registryAddress?: string; chainId?: number };
  };
  snap.meta = {
    ...snap.meta,
    lastIndexedBlock: String(head + 1000n),
    registryAddress: registry,
    chainId: 31337,
  };
  writeFileSync(snapshotPath, JSON.stringify(snap));

  await backend!.stop();
  backend = new EvmBackend({
    rpcUrl,
    registry,
    deploymentBlock,
    snapshotPath,
    pollMs: 100,
  });
  await backend.start();
  await backend.syncFromChain();

  const healthAfter = await backend!.health();
  expect(BigInt(healthAfter.lastBlock ?? "0")).toBeLessThanOrEqual(head + 5n);
});

test("EvmBackend indexes OperatorTransferred", async () => {
  if (skip) return;
  const transferOpLabel = "org.openclaw.evm-transfer";
  const account0 = privateKeyToAccount(ANVIL_DEFAULT_KEY);
  const newOwner = privateKeyToAccount(ANVIL_KEY_2);
  const ownerWallet = createWalletClient({
    account: account0,
    chain: foundry,
    transport: http(rpcUrl),
  });
  const acceptWallet = createWalletClient({
    account: newOwner,
    chain: foundry,
    transport: http(rpcUrl),
  });
  const pc = createPublicClient({ chain: foundry, transport: http(rpcUrl) });

  await ownerWallet.writeContract({
    address: registry,
    abi: clankerIdentityAbi,
    functionName: "registerOperator",
    args: [transferOpLabel],
  });
  const operatorIdBytes = keccak256(toBytes(transferOpLabel)) as Hex;

  const proposeHash = await ownerWallet.writeContract({
    address: registry,
    abi: clankerIdentityAbi,
    functionName: "proposeOperatorTransfer",
    args: [operatorIdBytes, newOwner.address],
  });
  await pc.waitForTransactionReceipt({ hash: proposeHash });
  const acceptHash = await acceptWallet.writeContract({
    address: registry,
    abi: clankerIdentityAbi,
    functionName: "acceptOperatorTransfer",
    args: [operatorIdBytes],
  });
  await pc.waitForTransactionReceipt({ hash: acceptHash });

  await backend!.syncFromChain();
  const op = await backend!.getOperator(transferOpLabel);
  expect(op?.public_keys?.[0]?.public_key?.toLowerCase()).toBe(newOwner.address.toLowerCase());
});

test("EvmBackend hydrates revoked entities from persisted snapshot", async () => {
  if (skip) return;
  const revokedBotLabel = "openclaw.evm.hydrate-revoke";
  const hydrateSnapshotPath = `${snapshotPath}.hydrate-isolated`;
  const now = new Date().toISOString();
  const healthBefore = await backend!.health();
  const lastBlock = healthBefore.lastBlock ?? "5";
  const snapshot = {
    version: 1,
    created: now,
    updated: now,
    operators: {
      [operatorLabel]: {
        operator_id: operatorLabel,
        status: "retired",
        created: now,
        updated: now,
        public_keys: [
          {
            key_id: "op-k1",
            algorithm: "secp256k1-eth",
            public_key: privateKeyToAccount(ANVIL_DEFAULT_KEY).address,
            created: now,
            status: "revoked",
          },
        ],
      },
    },
    bots: {
      [revokedBotLabel]: {
        bot_id: revokedBotLabel,
        operator_id: operatorLabel,
        status: "retired",
        created: now,
        updated: now,
        public_keys: [
          {
            key_id: "bot-k1",
            algorithm: "secp256k1-eth",
            public_key: privateKeyToAccount(ANVIL_KEY_1).address,
            created: now,
            status: "revoked",
          },
        ],
      },
    },
    operations: [],
    meta: {
      lastIndexedBlock: lastBlock,
      chainId: 31337,
      registryAddress: registry,
    },
  };
  writeFileSync(hydrateSnapshotPath, JSON.stringify(snapshot));

  const hydrated = new EvmBackend({
    rpcUrl,
    registry,
    deploymentBlock,
    snapshotPath: hydrateSnapshotPath,
    pollMs: 100,
  });
  await hydrated.start();

  const bot = await hydrated.getBot(revokedBotLabel);
  expect(bot?.status).toBe("retired");
  expect(bot?.public_keys?.[0]?.status).toBe("revoked");
  const op = await hydrated.getOperator(operatorLabel);
  expect(op?.status).toBe("retired");

  await hydrated.stop();
  unlinkSync(hydrateSnapshotPath);
});

test("EvmBackend marks revoked bot as retired", async () => {
  if (skip) return;
  const account0 = privateKeyToAccount(ANVIL_DEFAULT_KEY);
  const wallet = createWalletClient({
    account: account0,
    chain: foundry,
    transport: http(rpcUrl),
  });
  const botIdBytes = keccak256(toBytes(botLabel)) as Hex;
  const pc = createPublicClient({ chain: foundry, transport: http(rpcUrl) });
  const hash = await wallet.writeContract({
    address: registry,
    abi: clankerIdentityAbi,
    functionName: "revokeBot",
    args: [botIdBytes],
  });
  await pc.waitForTransactionReceipt({ hash });
  await backend!.syncFromChain();
  const bot = await backend!.getBot(botLabel);
  expect(bot?.status).toBe("retired");
});

test("EvmBackend marks revoked operator as retired", async () => {
  if (skip) return;
  const account0 = privateKeyToAccount(ANVIL_DEFAULT_KEY);
  const wallet = createWalletClient({
    account: account0,
    chain: foundry,
    transport: http(rpcUrl),
  });
  const operatorIdBytes = keccak256(toBytes(operatorLabel)) as Hex;
  const pc = createPublicClient({ chain: foundry, transport: http(rpcUrl) });
  const hash = await wallet.writeContract({
    address: registry,
    abi: clankerIdentityAbi,
    functionName: "revokeOperator",
    args: [operatorIdBytes],
  });
  await pc.waitForTransactionReceipt({ hash });
  await backend!.syncFromChain();
  const op = await backend!.getOperator(operatorLabel);
  expect(op?.status).toBe("retired");
});

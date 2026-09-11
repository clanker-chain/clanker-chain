import { afterAll, beforeAll, expect, setDefaultTimeout, test } from "bun:test";

// Integration tests spawn anvil + mqtt; keep headroom above viem/RPC jitter.
setDefaultTimeout(30_000);
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "path";
import {
  createPublicClient,
  createWalletClient,
  http,
  keccak256,
  toBytes,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";
import { clankerIdentityAbi } from "../../../packages/identity-node-client/src/abi/clanker-identity";
import {
  ANVIL_DEFAULT_KEY,
  ANVIL_KEY_1,
  ANVIL_KEY_2,
  deployTestRegistry,
  foundryOnPath,
} from "../../test-utils/deploy-registry";

const repoRoot = join(import.meta.dir, "../../..");
const chainDir = join(repoRoot, "chain");
const mqttAuthServiceDir = join(repoRoot, "hub/mqtt-auth-service");

function skipSiwe(): string | null {
  if (process.env.MQTT_EVM_TESTS_SKIP === "1" || process.env.MQTT_EVM_TESTS_SKIP === "true") {
    return "MQTT_EVM_TESTS_SKIP is set";
  }
  if (!foundryOnPath()) return "anvil or forge not on PATH";
  return null;
}

async function waitHttpOk(url: string, max = 40): Promise<void> {
  for (let i = 0; i < max; i++) {
    try {
      const r = await fetch(url);
      if (r.ok) {
        // /health returns JSON { ok: true, ... } when registry is reachable.
        const ct = r.headers.get("content-type") ?? "";
        if (ct.includes("application/json")) {
          const body = (await r.json()) as { ok?: boolean };
          if (body.ok === true) return;
        } else {
          return;
        }
      }
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`timeout waiting for ${url}`);
}

interface SiweHarness {
  cleanup: () => Promise<void>;
  botId: string;
  secondBotId: string;
  mqttUrl: string;
  registry: Hex;
  rpcUrl: string;
  operatorLabel: string;
  botSigner: ReturnType<typeof privateKeyToAccount>;
  secondBotSigner: ReturnType<typeof privateKeyToAccount>;
}

async function startSiweHarness(): Promise<SiweHarness> {
  const port = 21000 + Math.floor(Math.random() * 4000);
  const rpcUrl = `http://127.0.0.1:${port}`;
  const anvil = Bun.spawn(["anvil", "--port", String(port)], {
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

  const { registry } = await deployTestRegistry({
    rpcUrl,
    chainDir,
  });

  const operatorLabel = "org.openclaw.mqtt-evm-test";
  const botId = "openclaw.mqtt.siwe.test";
  const secondBotId = "openclaw.mqtt.siwe.test-2";
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
  const secondBotKeyAddr = privateKeyToAccount(ANVIL_KEY_2).address;
  await wallet.writeContract({
    address: registry,
    abi: clankerIdentityAbi,
    functionName: "registerBot",
    args: [operatorIdBytes as Hex, botId, botKeyAddr],
  });
  await wallet.writeContract({
    address: registry,
    abi: clankerIdentityAbi,
    functionName: "registerBot",
    args: [operatorIdBytes as Hex, secondBotId, secondBotKeyAddr],
  });

  const mqttPort = 23000 + Math.floor(Math.random() * 3000);
  const mqttUrl = `http://127.0.0.1:${mqttPort}`;
  const pairDir = mkdtempSync(join(tmpdir(), "mqtt-auth-pair-"));
  const mqttProc = Bun.spawn(["bun", "run", "src/server.ts"], {
    cwd: mqttAuthServiceDir,
    stdout: "ignore",
    stderr: "pipe",
    env: {
      ...process.env,
      MQTT_AUTH_PORT: String(mqttPort),
      CHAIN_RPC_URL: rpcUrl,
      REGISTRY_ADDRESS: registry,
      REGISTRY_CACHE_TTL_MS: "0",
      PAIRING_STORE_PATH: join(pairDir, "pairing.json"),
    },
  });

  await waitHttpOk(`${mqttUrl}/health`);

  return {
    botId,
    secondBotId,
    mqttUrl,
    registry,
    rpcUrl,
    operatorLabel,
    botSigner: privateKeyToAccount(ANVIL_KEY_1),
    secondBotSigner: privateKeyToAccount(ANVIL_KEY_2),
    cleanup: async () => {
      mqttProc.kill();
      anvil.kill();
      await Promise.all([mqttProc.exited, anvil.exited]);
      rmSync(pairDir, { recursive: true, force: true });
    },
  };
}

let siweHarness: SiweHarness | null = null;
const siweSkip = skipSiwe();

beforeAll(async () => {
  if (!siweSkip) {
    siweHarness = await startSiweHarness();
  }
}, 60_000);

afterAll(async () => {
  await siweHarness?.cleanup();
}, 30_000);

test("SIWE auth: happy path", async () => {
  if (siweSkip || !siweHarness) {
    console.log(`SKIP SIWE: ${siweSkip}`);
    return;
  }
  const { mqttUrl, botId, botSigner } = siweHarness;
  const nRes = await fetch(`${mqttUrl}/nonce?bot_id=${encodeURIComponent(botId)}`);
  expect(nRes.status).toBe(200);
  const nonceJson = (await nRes.json()) as { nonce: string; message: string };
  const sig = await botSigner.signMessage({ message: nonceJson.message });
  const authRes = await fetch(`${mqttUrl}/auth`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: botId, password: `${nonceJson.nonce}.${sig}` }),
  });
  expect(authRes.status).toBe(200);
});

test("SIWE auth: replay nonce rejected", async () => {
  if (siweSkip || !siweHarness) return;
  const { mqttUrl, botId, botSigner } = siweHarness;
  const nRes = await fetch(`${mqttUrl}/nonce?bot_id=${encodeURIComponent(botId)}`);
  const { nonce, message } = (await nRes.json()) as { nonce: string; message: string };
  const sig = await botSigner.signMessage({ message });
  const body = JSON.stringify({ username: botId, password: `${nonce}.${sig}` });
  const ok = await fetch(`${mqttUrl}/auth`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });
  expect(ok.status).toBe(200);
  const replay = await fetch(`${mqttUrl}/auth`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });
  expect(replay.status).toBe(403);
});

test("SIWE auth: expired nonce", async () => {
  if (siweSkip || !siweHarness) return;
  const { rpcUrl, registry } = siweHarness;
  const port = 24000 + Math.floor(Math.random() * 500);
  const mqttUrl = `http://127.0.0.1:${port}`;
  const mqttProc = Bun.spawn(["bun", "run", "src/server.ts"], {
    cwd: mqttAuthServiceDir,
    stdout: "ignore",
    stderr: "ignore",
    env: {
      ...process.env,
      MQTT_AUTH_PORT: String(port),
      CHAIN_RPC_URL: rpcUrl,
      REGISTRY_ADDRESS: registry,
      REGISTRY_CACHE_TTL_MS: "0",
      MQTT_NONCE_TTL_MS: "1",
    },
  });
  await waitHttpOk(`${mqttUrl}/health`);
  const botId = "any.bot";
  const nRes = await fetch(`${mqttUrl}/nonce?bot_id=${encodeURIComponent(botId)}`);
  const { nonce, message: challenge } = (await nRes.json()) as { nonce: string; message: string };
  await new Promise((r) => setTimeout(r, 50));
  const sig = await privateKeyToAccount(ANVIL_KEY_1).signMessage({ message: challenge });
  const authRes = await fetch(`${mqttUrl}/auth`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: botId, password: `${nonce}.${sig}` }),
  });
  expect(authRes.status).toBe(403);
  mqttProc.kill();
  await mqttProc.exited;
});

test("SIWE auth: wrong signing key", async () => {
  if (siweSkip || !siweHarness) return;
  const { mqttUrl, botId } = siweHarness;
  const nRes = await fetch(`${mqttUrl}/nonce?bot_id=${encodeURIComponent(botId)}`);
  const { nonce, message } = (await nRes.json()) as { nonce: string; message: string };
  const badSig = await privateKeyToAccount(ANVIL_KEY_2).signMessage({ message });
  const authRes = await fetch(`${mqttUrl}/auth`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: botId, password: `${nonce}.${badSig}` }),
  });
  expect(authRes.status).toBe(403);
});

test("JWT password is rejected", async () => {
  if (siweSkip || !siweHarness) return;
  const { mqttUrl, botId } = siweHarness;
  const authRes = await fetch(`${mqttUrl}/auth`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: botId, password: "eyJhbGciOiJFZERTQSJ9.fake.jwt" }),
  });
  expect(authRes.status).toBe(403);
});

test("SIWE auth rejected when bot is revoked", async () => {
  if (siweSkip || !siweHarness) return;
  const { mqttUrl, secondBotId, secondBotSigner, registry, rpcUrl } = siweHarness;
  const account0 = privateKeyToAccount(ANVIL_DEFAULT_KEY);
  const wallet = createWalletClient({
    account: account0,
    chain: foundry,
    transport: http(rpcUrl),
  });
  const pc = createPublicClient({ chain: foundry, transport: http(rpcUrl) });
  const botIdBytes = keccak256(toBytes(secondBotId));
  const hash = await wallet.writeContract({
    address: registry,
    abi: clankerIdentityAbi,
    functionName: "revokeBot",
    args: [botIdBytes as Hex],
  });
  await pc.waitForTransactionReceipt({ hash, pollingInterval: 50, timeout: 30_000 });

  const nRes = await fetch(`${mqttUrl}/nonce?bot_id=${encodeURIComponent(secondBotId)}`);
  const { nonce, message } = (await nRes.json()) as { nonce: string; message: string };
  const sig = await secondBotSigner.signMessage({ message });
  const authRes = await fetch(`${mqttUrl}/auth`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: secondBotId, password: `${nonce}.${sig}` }),
  });
  expect(authRes.status).toBe(403);
  expect(await authRes.text()).toBe("bot_not_active");
});

test("SIWE auth rejected when operator is revoked", async () => {
  if (siweSkip || !siweHarness) return;
  const { mqttUrl, botId, botSigner, registry, rpcUrl, operatorLabel } = siweHarness;
  const account0 = privateKeyToAccount(ANVIL_DEFAULT_KEY);
  const wallet = createWalletClient({
    account: account0,
    chain: foundry,
    transport: http(rpcUrl),
  });
  const pc = createPublicClient({ chain: foundry, transport: http(rpcUrl) });
  const operatorIdBytes = keccak256(toBytes(operatorLabel));
  const hash = await wallet.writeContract({
    address: registry,
    abi: clankerIdentityAbi,
    functionName: "revokeOperator",
    args: [operatorIdBytes as Hex],
  });
  await pc.waitForTransactionReceipt({ hash, pollingInterval: 50, timeout: 30_000 });

  const nRes = await fetch(`${mqttUrl}/nonce?bot_id=${encodeURIComponent(botId)}`);
  const { nonce, message } = (await nRes.json()) as { nonce: string; message: string };
  const sig = await botSigner.signMessage({ message });
  const authRes = await fetch(`${mqttUrl}/auth`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: botId, password: `${nonce}.${sig}` }),
  });
  expect(authRes.status).toBe(403);
  expect(await authRes.text()).toBe("operator_not_active");
});

test("/health returns ok when RPC is up", async () => {
  if (siweSkip || !siweHarness) return;
  const res = await fetch(`${siweHarness.mqttUrl}/health`);
  expect(res.status).toBe(200);
  const body = (await res.json()) as {
    ok?: boolean;
    chainId?: number;
    blockNumber?: string;
    registryAddress?: string;
  };
  expect(body.ok).toBe(true);
  expect(typeof body.chainId).toBe("number");
  expect(body.blockNumber).toMatch(/^\d+$/);
  expect(body.registryAddress?.toLowerCase()).toBe(siweHarness.registry.toLowerCase());
});

test("/health returns 503 when RPC is up but registry address is bogus", async () => {
  if (siweSkip || !siweHarness) {
    if (siweSkip) console.log(`SKIP SIWE: ${siweSkip}`);
    return;
  }
  const port = 25000 + Math.floor(Math.random() * 500);
  const mqttUrl = `http://127.0.0.1:${port}`;
  // Valid address shape, no contract code on Anvil — botFee eth_call fails.
  const bogusRegistry = "0x0000000000000000000000000000000000000001";
  const mqttProc = Bun.spawn(["bun", "run", "src/server.ts"], {
    cwd: mqttAuthServiceDir,
    stdout: "ignore",
    stderr: "ignore",
    env: {
      ...process.env,
      MQTT_AUTH_PORT: String(port),
      CHAIN_RPC_URL: siweHarness.rpcUrl,
      REGISTRY_ADDRESS: bogusRegistry,
      REGISTRY_CACHE_TTL_MS: "0",
      CHAIN_RPC_TIMEOUT_MS: "3000",
    },
  });

  let saw503 = false;
  for (let i = 0; i < 40; i++) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 2_000);
    try {
      const res = await fetch(`${mqttUrl}/health`, { signal: ac.signal });
      if (res.status === 503) {
        const body = (await res.json()) as { ok?: boolean; error?: string };
        expect(body.ok).toBe(false);
        expect(body.error).toBe("registry_unavailable");
        saw503 = true;
        break;
      }
    } catch {
      /* server not up yet, or aborted */
    } finally {
      clearTimeout(timer);
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  mqttProc.kill();
  await mqttProc.exited;
  expect(saw503).toBe(true);
});

test("/health returns 503 when RPC is down", async () => {
  if (siweSkip) {
    console.log(`SKIP SIWE: ${siweSkip}`);
    return;
  }
  const port = 25000 + Math.floor(Math.random() * 500);
  const mqttUrl = `http://127.0.0.1:${port}`;
  const mqttProc = Bun.spawn(["bun", "run", "src/server.ts"], {
    cwd: mqttAuthServiceDir,
    stdout: "ignore",
    stderr: "ignore",
    env: {
      ...process.env,
      MQTT_AUTH_PORT: String(port),
      // Reserved TEST-NET address — connection refused (fast fail with short RPC timeout).
      CHAIN_RPC_URL: "http://127.0.0.1:1",
      REGISTRY_ADDRESS: "0x1234567890123456789012345678901234567890",
      REGISTRY_CACHE_TTL_MS: "0",
      CHAIN_RPC_TIMEOUT_MS: "500",
    },
  });

  let saw503 = false;
  for (let i = 0; i < 40; i++) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 2_000);
    try {
      const res = await fetch(`${mqttUrl}/health`, { signal: ac.signal });
      if (res.status === 503) {
        const body = (await res.json()) as { ok?: boolean; error?: string };
        expect(body.ok).toBe(false);
        expect(body.error).toBe("registry_unavailable");
        saw503 = true;
        break;
      }
    } catch {
      /* server not up yet, or aborted */
    } finally {
      clearTimeout(timer);
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  mqttProc.kill();
  await mqttProc.exited;
  expect(saw503).toBe(true);
});

test("/auth returns 403 registry_unavailable when RPC is down", async () => {
  if (siweSkip) {
    console.log(`SKIP SIWE: ${siweSkip}`);
    return;
  }
  // Distinct port range from /health down tests (25000+) to avoid collisions.
  const port = 26000 + Math.floor(Math.random() * 500);
  const mqttUrl = `http://127.0.0.1:${port}`;
  const mqttProc = Bun.spawn(["bun", "run", "src/server.ts"], {
    cwd: mqttAuthServiceDir,
    stdout: "ignore",
    stderr: "ignore",
    env: {
      ...process.env,
      MQTT_AUTH_PORT: String(port),
      CHAIN_RPC_URL: "http://127.0.0.1:1",
      REGISTRY_ADDRESS: "0x1234567890123456789012345678901234567890",
      REGISTRY_CACHE_TTL_MS: "0",
      CHAIN_RPC_TIMEOUT_MS: "500",
    },
  });

  const botId = "openclaw.mqtt.rpc-down";
  let ready = false;
  for (let i = 0; i < 40; i++) {
    try {
      const nRes = await fetch(`${mqttUrl}/nonce?bot_id=${encodeURIComponent(botId)}`);
      if (nRes.status === 200) {
        ready = true;
        break;
      }
    } catch {
      /* server not up yet */
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  expect(ready).toBe(true);

  const nRes = await fetch(`${mqttUrl}/nonce?bot_id=${encodeURIComponent(botId)}`);
  const { nonce, message } = (await nRes.json()) as { nonce: string; message: string };
  const sig = await privateKeyToAccount(ANVIL_KEY_1).signMessage({ message });
  const authRes = await fetch(`${mqttUrl}/auth`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: botId, password: `${nonce}.${sig}` }),
  });
  expect(authRes.status).toBe(403);
  expect(await authRes.text()).toBe("registry_unavailable");

  mqttProc.kill();
  await mqttProc.exited;
});

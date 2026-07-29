import { afterAll, beforeAll, expect, test } from "bun:test";
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
import { clankerIdentityAbi } from "../../identity-node-client/src/abi/clanker-identity";
import {
  ANVIL_DEFAULT_KEY,
  ANVIL_KEY_1,
  ANVIL_KEY_2,
  deployTestRegistry,
  foundryOnPath,
} from "../../test-utils/deploy-registry";

const repoRoot = join(import.meta.dir, "../..");
const chainDir = join(repoRoot, "chain");
const mqttAuthServiceDir = join(repoRoot, "mqtt-auth-service");

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
      if (r.ok) return;
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
    },
  };
}

let siweHarness: SiweHarness | null = null;
const siweSkip = skipSiwe();

beforeAll(async () => {
  if (!siweSkip) {
    siweHarness = await startSiweHarness();
  }
});

afterAll(async () => {
  await siweHarness?.cleanup();
});

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
  await pc.waitForTransactionReceipt({ hash });

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
  await pc.waitForTransactionReceipt({ hash });

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

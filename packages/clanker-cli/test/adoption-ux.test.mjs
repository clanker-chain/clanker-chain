import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getAddress } from "viem";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import {
  defaultOperatorKeyPath,
  exportFoundryKey,
  listFoundryAccounts,
  resolveFoundryAddress,
} from "../lib/foundry.mjs";
import {
  OPENCLAW_PLUGIN_PIN,
  botIdentityCard,
  botIdentityJson,
  ensureMqttPlugins,
  hubConnectChecklist,
  wireOpenClawMqtt,
} from "../lib/openclaw-wire.mjs";
import {
  initProfile,
  writeOperator,
} from "../lib/profile.mjs";
import { runDoctorChecks } from "../lib/doctor.mjs";
import {
  consumerFundHints,
  generateOperatorKeyFile,
} from "../lib/operator-key.mjs";

describe("foundry helpers", () => {
  it("lists accounts via mocked cast wallet list", () => {
    const spawn = () => ({
      status: 0,
      stdout: "clanker-sepolia-deployer (0x07e8…)\nother-account\n",
      error: null,
    });
    const { available, accounts } = listFoundryAccounts({ spawn });
    assert.equal(available, true);
    assert.ok(accounts.includes("clanker-sepolia-deployer"));
    assert.ok(accounts.includes("other-account"));
  });

  it("resolves address from cast stdout", () => {
    const addr = "0x07e8CFD171E63915A441B0E8ff9E3CC2Cd27c4B4";
    const spawn = () => ({
      status: 0,
      stdout: `${addr}\n`,
      stderr: "",
      error: null,
    });
    assert.equal(
      resolveFoundryAddress("acct", { spawn, inheritStdio: false }),
      getAddress(addr),
    );
  });

  it("exports key to 0o600 file without relying on printed key", () => {
    const home = mkdtempSync(join(tmpdir(), "clanker-foundry-"));
    const dest = defaultOperatorKeyPath(home);
    const pk = generatePrivateKey();
    const expected = privateKeyToAccount(pk).address;
    const spawn = () => ({
      status: 0,
      stdout: `${pk}\n`,
      stderr: "",
      error: null,
    });
    const out = exportFoundryKey("acct", dest, { spawn, inheritStdio: false });
    assert.equal(out.path, dest);
    assert.equal(out.address, expected);
    assert.equal(existsSync(dest), true);
    const raw = readFileSync(dest, "utf8").trim();
    assert.match(raw, /^0x[0-9a-fA-F]{64}$/);
    rmSync(home, { recursive: true, force: true });
  });
});

describe("openclaw wire", () => {
  it("creates openclaw.json skeleton", () => {
    const openclawHome = mkdtempSync(join(tmpdir(), "oc-wire-"));
    const wire = wireOpenClawMqtt({
      botId: "you.laptop",
      operatorId: "org.you",
      network: {
        rpc: "https://sepolia.base.org",
        registry: "0xD650467f9D7A20f37E55ec23Ca1c711598f97958",
        brokerUrl: "mqtts://mqtt.clanker-chain.com:8883",
        mqttAuthServiceUrl: "https://mqtt-auth.clanker-chain.com",
      },
      keyPath: "/tmp/you.laptop.key",
      openclawHome,
    });
    assert.equal(wire.created, true);
    assert.equal(wire.pluginPin, OPENCLAW_PLUGIN_PIN);
    const cfg = JSON.parse(readFileSync(wire.path, "utf8"));
    assert.deepEqual(cfg.plugins.enabled, ["mqtt", "mqtt-tools"]);
    assert.equal(cfg.channels.mqtt.botId, "you.laptop");
    assert.equal(cfg.channels.mqtt.privateKeyFile, "/tmp/you.laptop.key");
    rmSync(openclawHome, { recursive: true, force: true });
  });

  it("merges channels.mqtt without wiping unrelated config", () => {
    const openclawHome = mkdtempSync(join(tmpdir(), "oc-merge-"));
    const cfgPath = join(openclawHome, "openclaw.json");
    writeFileSync(
      cfgPath,
      JSON.stringify(
        {
          agents: { defaults: { model: "keep-me" } },
          plugins: { enabled: ["other"] },
          channels: { mqtt: { enabled: true, botId: "old", extra: 1 } },
        },
        null,
        2,
      ),
      "utf8",
    );
    const wire = wireOpenClawMqtt({
      botId: "new.bot",
      operatorId: "org.you",
      network: {
        rpc: "http://127.0.0.1:8545",
        registry: null,
        brokerUrl: "mqtt://localhost:1883",
      },
      openclawHome,
    });
    assert.equal(wire.created, false);
    const cfg = JSON.parse(readFileSync(cfgPath, "utf8"));
    assert.equal(cfg.agents.defaults.model, "keep-me");
    assert.ok(cfg.plugins.enabled.includes("other"));
    assert.ok(cfg.plugins.enabled.includes("mqtt"));
    assert.ok(cfg.plugins.enabled.includes("mqtt-tools"));
    assert.equal(cfg.channels.mqtt.botId, "new.bot");
    assert.equal(cfg.channels.mqtt.extra, 1);
    rmSync(openclawHome, { recursive: true, force: true });
  });

  it("ensureMqttPlugins and checklist", () => {
    const cfg = ensureMqttPlugins({ plugins: { enabled: ["x"] } });
    assert.deepEqual(cfg.plugins.enabled, ["x", "mqtt", "mqtt-tools"]);
    const lines = hubConnectChecklist({
      botId: "you.laptop",
      channelsMqtt: { brokerUrl: "mqtts://mqtt.clanker-chain.com:8883" },
    });
    assert.ok(lines.some((l) => l.includes(`@${OPENCLAW_PLUGIN_PIN}`)));
    assert.ok(lines.some((l) => l.includes("clanker pair add")));
    assert.ok(lines[0].includes("already wired"));
  });

  it("botIdentityCard separates bot key from op.key", () => {
    const lines = botIdentityCard({
      botId: "you.laptop",
      operatorId: "org.you",
      keyPath: "/home/u/.openclaw/keys/you.laptop.key",
      openclawPath: "/home/u/.openclaw/openclaw.json",
      created: true,
    });
    assert.equal(lines[0], "Bot identity (what OpenClaw uses to CONNECT):");
    assert.ok(lines.some((l) => l.includes("you.laptop")));
    assert.ok(lines.some((l) => l.includes("/home/u/.openclaw/keys/you.laptop.key")));
    assert.ok(lines.some((l) => l.includes("channels.mqtt created")));
    assert.ok(lines.some((l) => l.includes("Do not give the bot ~/.clanker/op.key")));
    const json = botIdentityJson({
      botId: "you.laptop",
      keyPath: "/tmp/bot.key",
      openclawConfigPath: "/tmp/openclaw.json",
    });
    assert.equal(json.botId, "you.laptop");
    assert.match(json.warnOperatorKey, /op\.key/);
  });
});

describe("doctor mqtt-auth health", () => {
  it("passes when /health returns ok", async () => {
    const home = mkdtempSync(join(tmpdir(), "clanker-health-"));
    initProfile("sepolia", { home });
    writeOperator(
      {
        label: "org.openclaw.pat",
        owner: "0x07e8CFD171E63915A441B0E8ff9E3CC2Cd27c4B4",
      },
      home,
    );
    const report = await runDoctorChecks({
      home,
      env: {},
      spawn: () => ({ status: 1, error: new Error("no cast") }),
      fetchImpl: async () => ({ ok: true, status: 200 }),
      skipBalance: true,
    });
    const health = report.checks.find((c) => c.id === "mqtt_auth_health");
    assert.ok(health);
    assert.equal(health.level, "pass");
    rmSync(home, { recursive: true, force: true });
  });

  it("warns when /health is unreachable", async () => {
    const home = mkdtempSync(join(tmpdir(), "clanker-health2-"));
    initProfile("sepolia", { home });
    writeOperator(
      {
        label: "org.openclaw.pat",
        owner: "0x07e8CFD171E63915A441B0E8ff9E3CC2Cd27c4B4",
      },
      home,
    );
    const report = await runDoctorChecks({
      home,
      env: {},
      spawn: () => ({ status: 1, error: new Error("no cast") }),
      fetchImpl: async () => {
        throw new Error("ECONNREFUSED");
      },
      skipBalance: true,
    });
    const health = report.checks.find((c) => c.id === "mqtt_auth_health");
    assert.equal(health.level, "warn");
    assert.match(health.message, /ECONNREFUSED/);
    rmSync(home, { recursive: true, force: true });
  });
});

describe("generateOperatorKeyFile", () => {
  it("writes key and returns address", () => {
    const home = mkdtempSync(join(tmpdir(), "clanker-gen-"));
    const dest = defaultOperatorKeyPath(home);
    const out = generateOperatorKeyFile(dest);
    assert.equal(out.path, dest);
    assert.match(out.address, /^0x[0-9a-fA-F]{40}$/);
    const raw = readFileSync(dest, "utf8").trim();
    assert.match(raw, /^0x[0-9a-fA-F]{64}$/);
    assert.equal(privateKeyToAccount(raw).address, out.address);
    rmSync(home, { recursive: true, force: true });
  });

  it("refuses overwrite without force", () => {
    const home = mkdtempSync(join(tmpdir(), "clanker-gen2-"));
    const dest = defaultOperatorKeyPath(home);
    generateOperatorKeyFile(dest);
    assert.throws(() => generateOperatorKeyFile(dest), /already exists/);
    const again = generateOperatorKeyFile(dest, { force: true });
    assert.ok(again.address);
    rmSync(home, { recursive: true, force: true });
  });

  it("consumerFundHints include fund then mint", () => {
    const lines = consumerFundHints({
      address: "0x07e8CFD171E63915A441B0E8ff9E3CC2Cd27c4B4",
      label: "org.you",
    });
    assert.ok(lines.some((l) => l.includes("clanker fund")));
    assert.ok(lines.some((l) => l.includes("operator mint org.you")));
  });
});

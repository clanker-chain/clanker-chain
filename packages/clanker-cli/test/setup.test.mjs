import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  writeFileSync,
  rmSync,
  readFileSync,
  mkdirSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { privateKeyToAccount } from "viem/accounts";
import {
  ANVIL_DEFAULT_ADDRESS,
  ANVIL_DEFAULT_PRIVATE_KEY,
  SEPOLIA_REGISTRY,
  initProfile,
  loadOperator,
  writeOperator,
} from "../lib/profile.mjs";
import { resolveReadIdentity } from "../lib/resolve.mjs";
import {
  SEPOLIA_FAST_FROM_BLOCK,
  detectSetupHints,
  listOpenclawBotKeys,
  parseCastWalletList,
  formatSetupDetectTable,
} from "../lib/setup-detect.mjs";
import {
  applySetup,
  assertSetupIdentity,
  attachBotKeyFile,
  buildKeyPointer,
  parseSetupFlags,
  runSetupNonInteractive,
} from "../lib/setup.mjs";
import { openclawConfigPath } from "../lib/openclaw-wire.mjs";

describe("formatSetupDetectTable", () => {
  it("renders aligned What/Value columns", () => {
    const home = mkdtempSync(join(tmpdir(), "clanker-table-"));
    initProfile("sepolia", { home });
    const table = formatSetupDetectTable(
      detectSetupHints({
        home,
        env: {},
        spawn: () => ({ status: 0, stdout: "deployer (Local)\n", error: null }),
        openclawDir: join(home, "no-oc"),
      }),
    );
    assert.match(table, /What\s+Value/);
    assert.match(table, /config\.json/);
    assert.match(table, /operator\.json\s+missing/);
    assert.match(table, /Foundry accounts/);
    assert.match(table, /preset=sepolia/);
    rmSync(home, { recursive: true, force: true });
  });
});

describe("parseCastWalletList", () => {
  it("parses cast wallet list lines", () => {
    const names = parseCastWalletList(
      "clanker-sepolia-deployer (Local)\n0xother-account (Local)\n",
    );
    assert.deepEqual(names, ["clanker-sepolia-deployer", "other-account"]);
  });
});

describe("listOpenclawBotKeys", () => {
  it("lists .key basenames", () => {
    const dir = mkdtempSync(join(tmpdir(), "oc-keys-"));
    writeFileSync(join(dir, "openclaw.france.prod-1.key"), "00");
    writeFileSync(join(dir, "readme.txt"), "x");
    assert.deepEqual(listOpenclawBotKeys({ openclawDir: dir }), [
      "openclaw.france.prod-1",
    ]);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("detectSetupHints", () => {
  it("reports config/operator and mocked foundry", () => {
    const home = mkdtempSync(join(tmpdir(), "clanker-hints-"));
    initProfile("sepolia", { home });
    writeOperator(
      { label: "org.test", owner: "0x07e8CFD171E63915A441B0E8ff9E3CC2Cd27c4B4" },
      home,
    );
    const hints = detectSetupHints({
      home,
      env: {},
      spawn: () => ({ status: 0, stdout: "deployer (Local)\n", error: null }),
      castBin: "cast",
      openclawDir: join(home, "missing-oc"),
    });
    assert.equal(hints.hasConfig, true);
    assert.equal(hints.hasOperator, true);
    assert.equal(hints.foundryAvailable, true);
    assert.deepEqual(hints.foundryAccounts, ["deployer"]);
    rmSync(home, { recursive: true, force: true });
  });
});

describe("assertSetupIdentity", () => {
  it("refuses Anvil address on public RPC", async () => {
    await assert.rejects(
      () =>
        assertSetupIdentity({
          rpc: "https://sepolia.base.org",
          registry: SEPOLIA_REGISTRY,
          label: "org.x",
          address: ANVIL_DEFAULT_ADDRESS,
        }),
      /Anvil account #0/,
    );
  });

  it("allows skipChainCheck", async () => {
    const r = await assertSetupIdentity({
      rpc: "https://sepolia.base.org",
      registry: SEPOLIA_REGISTRY,
      label: "org.x",
      address: "0x07e8CFD171E63915A441B0E8ff9E3CC2Cd27c4B4",
      skipChainCheck: true,
    });
    assert.equal(r.skipped, true);
  });
});

describe("buildKeyPointer / applySetup", () => {
  it("writes read-only operator without key", () => {
    const home = mkdtempSync(join(tmpdir(), "clanker-setup-"));
    const result = applySetup(
      {
        preset: "sepolia",
        force: true,
        fromBlock: SEPOLIA_FAST_FROM_BLOCK,
        label: "org.openclaw.pat",
        address: "0x07e8CFD171E63915A441B0E8ff9E3CC2Cd27c4B4",
        key: null,
      },
      { home },
    );
    const op = JSON.parse(readFileSync(result.operatorPath, "utf8"));
    assert.equal(op.label, "org.openclaw.pat");
    assert.equal(op.owner, "0x07e8CFD171E63915A441B0E8ff9E3CC2Cd27c4B4");
    assert.equal(op.key, undefined);
    const cfg = JSON.parse(readFileSync(result.configPath, "utf8"));
    assert.equal(cfg.fromBlock, SEPOLIA_FAST_FROM_BLOCK.toString());
    rmSync(home, { recursive: true, force: true });
  });

  it("writes keyFile pointer", () => {
    const home = mkdtempSync(join(tmpdir(), "clanker-setup-key-"));
    const keyPath = join(home, "op.key");
    // non-anvil key
    const key =
      "0x1111111111111111111111111111111111111111111111111111111111111111";
    writeFileSync(keyPath, `${key}\n`);
    const addr = privateKeyToAccount(key).address;
    const pointer = buildKeyPointer({ keyFile: keyPath, env: {} });
    assert.deepEqual(pointer, { type: "keyFile", value: keyPath });
    applySetup(
      {
        preset: "local",
        force: true,
        label: "org.local",
        address: addr,
        key: pointer,
        registryAddress: "0x0000000000000000000000000000000000000001",
      },
      { home },
    );
    const op = loadOperator(home);
    assert.equal(op.key.type, "keyFile");
    rmSync(home, { recursive: true, force: true });
  });
});

describe("runSetupNonInteractive", () => {
  it("requires flags when not TTY", async () => {
    await assert.rejects(
      () => runSetupNonInteractive([], { home: mkdtempSync(join(tmpdir(), "x-")) }),
      /--preset/,
    );
  });

  it("writes profile with --yes flags and skip-chain-check", async () => {
    const home = mkdtempSync(join(tmpdir(), "clanker-ni-"));
    const result = await runSetupNonInteractive(
      [
        "--preset",
        "sepolia",
        "--operator",
        "org.openclaw.pat",
        "--address",
        "0x07e8CFD171E63915A441B0E8ff9E3CC2Cd27c4B4",
        "--skip-key",
        "--skip-chain-check",
        "--yes",
        "--force",
      ],
      { home, env: {} },
    );
    assert.ok(existsSync(result.configPath));
    assert.equal(loadOperator(home).label, "org.openclaw.pat");
    assert.equal(loadOperator(home).key, undefined);
    rmSync(home, { recursive: true, force: true });
  });

  it("rejects Anvil address on sepolia", async () => {
    const home = mkdtempSync(join(tmpdir(), "clanker-anvil-"));
    await assert.rejects(
      () =>
        runSetupNonInteractive(
          [
            "--preset",
            "sepolia",
            "--operator",
            "org.x",
            "--address",
            ANVIL_DEFAULT_ADDRESS,
            "--skip-key",
            "--yes",
            "--force",
          ],
          { home, env: {} },
        ),
      /Anvil account #0/,
    );
    rmSync(home, { recursive: true, force: true });
  });

  it("writes profile with --generate-key", async () => {
    const home = mkdtempSync(join(tmpdir(), "clanker-genkey-"));
    const result = await runSetupNonInteractive(
      [
        "--preset",
        "sepolia",
        "--operator",
        "org.you",
        "--generate-key",
        "--skip-chain-check",
        "--yes",
        "--force",
      ],
      { home, env: {} },
    );
    assert.ok(existsSync(result.configPath));
    const op = loadOperator(home);
    assert.equal(op.label, "org.you");
    assert.equal(op.key?.type, "keyFile");
    assert.ok(existsSync(op.key.value));
    assert.match(op.owner, /^0x[0-9a-fA-F]{40}$/);
    rmSync(home, { recursive: true, force: true });
  });

  it("refuses --generate-key overwrite without --force", async () => {
    const home = mkdtempSync(join(tmpdir(), "clanker-genkey2-"));
    await runSetupNonInteractive(
      [
        "--preset",
        "sepolia",
        "--operator",
        "org.you",
        "--generate-key",
        "--skip-chain-check",
        "--yes",
        "--force",
      ],
      { home, env: {} },
    );
    await assert.rejects(
      () =>
        runSetupNonInteractive(
          [
            "--preset",
            "sepolia",
            "--operator",
            "org.you",
            "--generate-key",
            "--skip-chain-check",
            "--yes",
          ],
          { home, env: {} },
        ),
      /already exists/,
    );
    rmSync(home, { recursive: true, force: true });
  });
});

describe("resolveReadIdentity profile owner", () => {
  it("uses operator.json owner when no signing key", () => {
    const home = mkdtempSync(join(tmpdir(), "clanker-read-"));
    initProfile("sepolia", { home, fromBlock: SEPOLIA_FAST_FROM_BLOCK });
    writeOperator(
      {
        label: "org.openclaw.pat",
        owner: "0x07e8CFD171E63915A441B0E8ff9E3CC2Cd27c4B4",
      },
      home,
    );
    const resolved = resolveReadIdentity([], { home, env: {} });
    assert.equal(resolved.source, "profile owner");
    assert.equal(
      resolved.address.toLowerCase(),
      "0x07e8cfd171e63915a441b0e8ff9e3cc2cd27c4b4",
    );
    rmSync(home, { recursive: true, force: true });
  });

  it("errors with setup hint when nothing configured", () => {
    const home = mkdtempSync(join(tmpdir(), "clanker-empty-"));
    initProfile("sepolia", { home });
    assert.throws(
      () => resolveReadIdentity([], { home, env: {} }),
      /clanker setup/,
    );
    rmSync(home, { recursive: true, force: true });
  });

  it("prefers --address over profile owner", () => {
    const home = mkdtempSync(join(tmpdir(), "clanker-addr-"));
    initProfile("sepolia", { home });
    writeOperator(
      {
        label: "org.openclaw.pat",
        owner: "0x07e8CFD171E63915A441B0E8ff9E3CC2Cd27c4B4",
      },
      home,
    );
    const other = "0x0000000000000000000000000000000000000001";
    const resolved = resolveReadIdentity(["--address", other], { home, env: {} });
    assert.equal(resolved.source, "--address");
    assert.equal(resolved.address.toLowerCase(), other.toLowerCase());
    rmSync(home, { recursive: true, force: true });
  });
});

describe("writeOperator omit key", () => {
  it("does not default to env pointer", () => {
    const home = mkdtempSync(join(tmpdir(), "clanker-wo-"));
    writeOperator(
      { label: "a", owner: "0x07e8CFD171E63915A441B0E8ff9E3CC2Cd27c4B4" },
      home,
    );
    const raw = JSON.parse(readFileSync(join(home, "operator.json"), "utf8"));
    assert.equal("key" in raw, false);
    rmSync(home, { recursive: true, force: true });
  });
});

describe("attach / bot-key", () => {
  it("parseSetupFlags reads --bot-key and --skip-key", () => {
    const f = parseSetupFlags([
      "--preset",
      "sepolia",
      "--operator",
      "org.you",
      "--address",
      "0x07e8CFD171E63915A441B0E8ff9E3CC2Cd27c4B4",
      "--skip-key",
      "--bot-key",
      "/tmp/you.laptop.key",
    ]);
    assert.equal(f.skipKey, true);
    assert.equal(f.botKey, "/tmp/you.laptop.key");
  });

  it("runSetupNonInteractive writes read-only profile", async () => {
    const home = mkdtempSync(join(tmpdir(), "clanker-attach-"));
    const owner = "0x07e8CFD171E63915A441B0E8ff9E3CC2Cd27c4B4";
    const result = await runSetupNonInteractive(
      [
        "--preset",
        "sepolia",
        "--operator",
        "org.you",
        "--address",
        owner,
        "--skip-key",
        "--yes",
        "--force",
        "--skip-chain-check",
      ],
      { home, env: {} },
    );
    const op = loadOperator(home);
    assert.equal(op.owner.toLowerCase(), owner.toLowerCase());
    assert.equal(op.key, undefined);
    assert.equal(result.operator.key, undefined);
    rmSync(home, { recursive: true, force: true });
  });

  it("attachBotKeyFile copies into openclaw keys and wires mqtt", () => {
    const home = mkdtempSync(join(tmpdir(), "clanker-botkey-"));
    const ocHome = join(home, "openclaw");
    const src = join(home, "you.laptop.key");
    writeFileSync(src, "0x1111111111111111111111111111111111111111111111111111111111111111\n");
    const attached = attachBotKeyFile(src, {
      operatorLabel: "org.you",
      network: {
        rpc: "https://sepolia.base.org",
        registry: SEPOLIA_REGISTRY,
        brokerUrl: "mqtts://mqtt.clanker-chain.com:8883",
        mqttAuthServiceUrl: "https://mqtt-auth.clanker-chain.com",
      },
      openclawHome: ocHome,
    });
    assert.equal(attached.botId, "you.laptop");
    assert.equal(existsSync(attached.keyPath), true);
    const cfg = JSON.parse(readFileSync(openclawConfigPath(ocHome), "utf8"));
    assert.equal(cfg.channels.mqtt.privateKeyFile, attached.keyPath);
    assert.equal(cfg.channels.mqtt.botId, "you.laptop");
    rmSync(home, { recursive: true, force: true });
  });
});

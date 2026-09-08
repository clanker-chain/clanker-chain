import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  SEPOLIA_FAST_FROM_BLOCK,
  initProfile,
  writeOperator,
  PRESETS,
} from "../lib/profile.mjs";
import { formatCliError, isInteractive, nextHint } from "../lib/ui.mjs";
import { runDoctorChecks, runDoctor } from "../lib/doctor.mjs";

describe("ui helpers", () => {
  it("formatCliError includes error/because/try", () => {
    const s = formatCliError({
      error: "missing key",
      because: "mint sends a tx",
      try: ["clanker setup --key-file …"],
    });
    assert.match(s, /error: missing key/);
    assert.match(s, /because: mint sends a tx/);
    assert.match(s, /try:/);
    assert.match(s, /clanker setup/);
  });

  it("isInteractive false with --yes or --json", () => {
    assert.equal(isInteractive(["--yes"], { stdinTTY: true }), false);
    assert.equal(isInteractive(["--json"], { stdinTTY: true }), false);
    assert.equal(isInteractive([], { stdinTTY: false }), false);
    assert.equal(isInteractive([], { stdinTTY: true }), true);
  });

  it("nextHint prints Next block", () => {
    let out = "";
    const orig = console.log;
    console.log = (...a) => {
      out += a.join(" ") + "\n";
    };
    try {
      nextHint(["clanker whoami"]);
    } finally {
      console.log = orig;
    }
    assert.match(out, /Next:/);
    assert.match(out, /clanker whoami/);
  });
});

describe("sepolia preset fromBlock", () => {
  it("defaults to fast public-RPC floor", () => {
    assert.equal(PRESETS.sepolia.fromBlock, SEPOLIA_FAST_FROM_BLOCK);
    const home = mkdtempSync(join(tmpdir(), "clanker-fb-"));
    const { config } = initProfile("sepolia", { home });
    assert.equal(config.fromBlock, SEPOLIA_FAST_FROM_BLOCK.toString());
    rmSync(home, { recursive: true, force: true });
  });
});

describe("doctor", () => {
  it("fails without operator.json", async () => {
    const home = mkdtempSync(join(tmpdir(), "clanker-doc-"));
    initProfile("sepolia", { home });
    const report = await runDoctorChecks({
      home,
      env: {},
      spawn: () => ({ status: 1, error: new Error("no cast") }),
      fetchImpl: async () => ({ ok: true, status: 200 }),
    });
    assert.equal(report.readyWhoami, false);
    assert.equal(report.ok, false);
    rmSync(home, { recursive: true, force: true });
  });

  it("passes whoami readiness with operator owner", async () => {
    const home = mkdtempSync(join(tmpdir(), "clanker-doc2-"));
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
      spawn: () => ({ status: 0, stdout: "", error: null }),
      fetchImpl: async () => ({ ok: true, status: 200 }),
    });
    assert.equal(report.readyWhoami, true);
    assert.equal(report.readyMint, false);
    assert.equal(report.ok, true);

    let printed = "";
    const orig = console.log;
    console.log = (...a) => {
      printed += a.join(" ") + "\n";
    };
    try {
      const { exitCode } = await runDoctor(["--json"], {
        home,
        env: {},
        fetchImpl: async () => ({ ok: true, status: 200 }),
      });
      assert.equal(exitCode, 0);
      const parsed = JSON.parse(printed.trim());
      assert.equal(parsed.readyWhoami, true);
    } finally {
      console.log = orig;
    }
    rmSync(home, { recursive: true, force: true });
  });
});

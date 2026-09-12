import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseEther } from "viem";
import { initProfile, writeOperator } from "../lib/profile.mjs";
import { runFund, parseFundFlags, openUrl } from "../lib/fund.mjs";
import { MINT_GAS_RESERVE_WEI } from "../lib/mint-budget.mjs";

describe("fund flags", () => {
  it("parseFundFlags defaults and overrides", () => {
    const d = parseFundFlags([]);
    assert.equal(d.noOpen, false);
    assert.equal(d.json, false);
    assert.ok(d.timeoutMs > 0);
    const o = parseFundFlags(["--no-open", "--json", "--timeout", "1000", "--poll", "200"]);
    assert.equal(o.noOpen, true);
    assert.equal(o.json, true);
    assert.equal(o.timeoutMs, 1000);
    assert.equal(o.pollMs, 200);
  });
});

describe("openUrl", () => {
  it("returns false when spawn throws", async () => {
    const ok = await openUrl("https://example.com", {
      spawnImpl: () => {
        throw new Error("no browser");
      },
    });
    assert.equal(ok, false);
  });

  it("returns true when spawn succeeds", async () => {
    const ok = await openUrl("https://example.com", {
      platform: "darwin",
      spawnImpl: () => ({ unref() {} }),
    });
    assert.equal(ok, true);
  });
});

describe("runFund", () => {
  it("local preset exits funded without polling", async () => {
    const home = mkdtempSync(join(tmpdir(), "clanker-fund-local-"));
    initProfile("local", {
      home,
      force: true,
      registryAddress: "0xD650467f9D7A20f37E55ec23Ca1c711598f97958",
    });
    writeOperator(
      {
        label: "org.you",
        owner: "0x07e8CFD171E63915A441B0E8ff9E3CC2Cd27c4B4",
      },
      home,
    );
    let printed = "";
    const orig = console.log;
    console.log = (...a) => {
      printed += a.join(" ") + "\n";
    };
    try {
      const out = await runFund(["--json"], { home, env: {} });
      assert.equal(out.exitCode, 0);
      assert.equal(out.funded, true);
      assert.equal(out.local, true);
      assert.match(printed, /prefunded/i);
    } finally {
      console.log = orig;
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("already funded exits 0 without opening", async () => {
    const home = mkdtempSync(join(tmpdir(), "clanker-fund-ok-"));
    initProfile("sepolia", { home, force: true });
    writeOperator(
      {
        label: "org.you",
        owner: "0x07e8CFD171E63915A441B0E8ff9E3CC2Cd27c4B4",
      },
      home,
    );
    const opFee = parseEther("0.001");
    const botFee = parseEther("0.0001");
    const pub = {
      readContract: async ({ functionName }) => {
        if (functionName === "operatorFee") return opFee;
        if (functionName === "botFee") return botFee;
        if (functionName === "operators") return ["0x0000000000000000000000000000000000000000", 0n, 0n];
        throw new Error(functionName);
      },
      getBalance: async () => opFee + botFee + MINT_GAS_RESERVE_WEI,
    };
    let opened = 0;
    let printed = "";
    const orig = console.log;
    console.log = (...a) => {
      printed += a.join(" ") + "\n";
    };
    try {
      const out = await runFund(["--no-open", "--json"], {
        home,
        env: {},
        publicClient: pub,
        openUrlImpl: async () => {
          opened += 1;
          return true;
        },
      });
      assert.equal(out.exitCode, 0);
      assert.equal(out.funded, true);
      assert.equal(opened, 0);
      assert.match(printed, /"funded": true/);
    } finally {
      console.log = orig;
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("times out when balance stays short", async () => {
    const home = mkdtempSync(join(tmpdir(), "clanker-fund-to-"));
    initProfile("sepolia", { home, force: true });
    writeOperator(
      {
        label: "org.you",
        owner: "0x07e8CFD171E63915A441B0E8ff9E3CC2Cd27c4B4",
      },
      home,
    );
    const opFee = parseEther("0.001");
    const botFee = parseEther("0.0001");
    const pub = {
      readContract: async ({ functionName }) => {
        if (functionName === "operatorFee") return opFee;
        if (functionName === "botFee") return botFee;
        if (functionName === "operators") return ["0x0000000000000000000000000000000000000000", 0n, 0n];
        throw new Error(functionName);
      },
      getBalance: async () => 0n,
    };
    let t = 0;
    let printed = "";
    const orig = console.log;
    console.log = (...a) => {
      printed += a.join(" ") + "\n";
    };
    try {
      const out = await runFund(
        ["--no-open", "--json", "--timeout", "250", "--poll", "100"],
        {
          home,
          env: {},
          publicClient: pub,
          openUrlImpl: async () => true,
          now: () => {
            const cur = t;
            t += 100;
            return cur;
          },
          sleep: async () => {},
        },
      );
      assert.equal(out.exitCode, 1);
      assert.equal(out.funded, false);
      assert.equal(out.timedOut, true);
      assert.match(printed, /timedOut/);
    } finally {
      console.log = orig;
      rmSync(home, { recursive: true, force: true });
    }
  });
});

/**
 * Pair sync helper unit tests (no network).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { syncAllowOperators } from "../lib/pair.mjs";

describe("syncAllowOperators", () => {
  it("adds and removes allowOperators on openclaw.json", () => {
    const home = mkdtempSync(join(tmpdir(), "pair-sync-"));
    try {
      mkdirSync(home, { recursive: true });
      writeFileSync(
        join(home, "openclaw.json"),
        JSON.stringify({ channels: { mqtt: { botId: "x", dmPolicy: "pairing" } } }, null, 2),
      );
      const add = syncAllowOperators({
        peerLabel: "org.peer",
        action: "add",
        openclawHome: home,
      });
      assert.equal(add.synced, true);
      assert.deepEqual(add.allowOperators, ["org.peer"]);
      const cfg = JSON.parse(readFileSync(join(home, "openclaw.json"), "utf8"));
      assert.deepEqual(cfg.channels.mqtt.allowOperators, ["org.peer"]);
      assert.equal(cfg.channels.mqtt.dmPolicy, "pairing");

      const rem = syncAllowOperators({
        peerLabel: "org.peer",
        action: "remove",
        openclawHome: home,
      });
      assert.deepEqual(rem.allowOperators, []);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("returns synced:false when openclaw.json is missing", () => {
    const home = mkdtempSync(join(tmpdir(), "pair-missing-"));
    try {
      const out = syncAllowOperators({
        peerLabel: "org.peer",
        action: "add",
        openclawHome: home,
      });
      assert.equal(out.synced, false);
      assert.equal(out.reason, "missing_openclaw_json");
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});

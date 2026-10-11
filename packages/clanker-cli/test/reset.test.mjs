import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import {
  initProfile,
  loadConfig,
  loadOperator,
  writeOperator,
} from "../lib/profile.mjs";
import {
  clearPrivySession,
  defaultClankerHome,
  loadPrivySession,
  privyKeychainAccount,
  savePrivySession,
} from "../lib/privy-session.mjs";
import {
  inspectLocalState,
  parseResetFlags,
  resetLocalState,
  runReset,
} from "../lib/reset.mjs";
import { runDoctorChecks } from "../lib/doctor.mjs";

const OWNER = "0x07e8CFD171E63915A441B0E8ff9E3CC2Cd27c4B4";

function tempHome(prefix = "clanker-reset-") {
  return mkdtempSync(join(tmpdir(), prefix));
}

function sampleSession(walletId = "wallet_1") {
  return {
    appId: "app",
    accessToken: "at",
    refreshToken: "rt",
    expiresAt: Date.now() + 60_000,
    walletId,
    address: OWNER,
    createdAt: Date.now(),
  };
}

function seededProfile(home) {
  initProfile("sepolia", { home, force: true });
  writeOperator(
    {
      label: "org.you",
      owner: OWNER,
      key: { type: "privy", value: "wallet_1" },
    },
    home,
  );
  writeFileSync(join(home, "op.key"), "0xabc\n", { mode: 0o600 });
  mkdirSync(join(home, "keys"), { recursive: true });
  writeFileSync(join(home, "keys", "you.laptop.key"), "0xdef\n", { mode: 0o600 });
  savePrivySession(sampleSession(), home);
}

describe("privy Keychain account scoping", () => {
  it("keeps default account for ~/.clanker", () => {
    assert.equal(privyKeychainAccount(defaultClankerHome()), "default");
    assert.equal(privyKeychainAccount(join(homedir(), ".clanker")), "default");
  });

  it("uses a distinct account per non-default home", () => {
    const a = privyKeychainAccount("/tmp/clanker-a");
    const b = privyKeychainAccount("/tmp/clanker-b");
    assert.match(a, /^[0-9a-f]{16}$/);
    assert.notEqual(a, "default");
    assert.notEqual(a, b);
  });
});

describe("session isolation per CLANKER_HOME", () => {
  it("does not leak a sandbox session into another home", () => {
    const homeA = tempHome("clanker-sess-a-");
    const homeB = tempHome("clanker-sess-b-");
    try {
      savePrivySession(sampleSession("wallet_a"), homeA);
      savePrivySession({ ...sampleSession("wallet_b"), walletId: "wallet_b" }, homeB);
      assert.equal(loadPrivySession(homeA)?.walletId, "wallet_a");
      assert.equal(loadPrivySession(homeB)?.walletId, "wallet_b");
      clearPrivySession(homeA);
      assert.equal(loadPrivySession(homeA), null);
      assert.equal(loadPrivySession(homeB)?.walletId, "wallet_b");
    } finally {
      clearPrivySession(homeA);
      clearPrivySession(homeB);
      rmSync(homeA, { recursive: true, force: true });
      rmSync(homeB, { recursive: true, force: true });
    }
  });
});

describe("parseResetFlags", () => {
  it("defaults to session + profile + keys", () => {
    const f = parseResetFlags([]);
    assert.equal(f.session, true);
    assert.equal(f.profile, true);
    assert.equal(f.keys, true);
    assert.equal(f.openclawKeys, false);
    assert.equal(f.dryRun, false);
  });

  it("--session keeps profile and keys", () => {
    const f = parseResetFlags(["--session", "--yes"]);
    assert.equal(f.session, true);
    assert.equal(f.profile, false);
    assert.equal(f.keys, false);
  });

  it("--keep-keys leaves op.key", () => {
    const f = parseResetFlags(["--keep-keys"]);
    assert.equal(f.profile, true);
    assert.equal(f.keys, false);
  });
});

describe("inspectLocalState / resetLocalState", () => {
  it("reports leftover env that the CLI cannot unset", () => {
    const home = tempHome();
    try {
      seededProfile(home);
      const inspect = inspectLocalState({
        home,
        env: { OPERATOR_PRIVATE_KEY: "0x01", PRIVY_APP_ID: "other" },
      });
      assert.equal(inspect.session.present, true);
      assert.equal(inspect.profile.label, "org.you");
      assert.ok(inspect.leftovers.some((l) => l.id === "OPERATOR_PRIVATE_KEY" && l.blocking));
      assert.ok(inspect.leftovers.some((l) => l.id === "PRIVY_APP_ID" && l.blocking));
    } finally {
      clearPrivySession(home);
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("dry-run does not delete", () => {
    const home = tempHome();
    try {
      seededProfile(home);
      const result = resetLocalState({
        home,
        env: {},
        session: true,
        profile: true,
        keys: true,
        dryRun: true,
      });
      assert.equal(result.dryRun, true);
      assert.equal(result.removed.length, 0);
      assert.ok(result.wouldRemove.length >= 3);
      assert.ok(loadConfig(home));
      assert.ok(loadOperator(home));
      assert.ok(loadPrivySession(home));
    } finally {
      clearPrivySession(home);
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("full reset clears session, profile, and local keys", () => {
    const home = tempHome();
    try {
      seededProfile(home);
      const result = resetLocalState({
        home,
        env: {},
        session: true,
        profile: true,
        keys: true,
      });
      assert.equal(result.ok, true);
      assert.ok(result.removed.length >= 3);
      assert.equal(loadConfig(home), null);
      assert.equal(loadOperator(home), null);
      assert.equal(loadPrivySession(home), null);
      assert.equal(existsSync(join(home, "op.key")), false);
      assert.equal(existsSync(join(home, "keys")), false);
    } finally {
      clearPrivySession(home);
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("session-only reset matches logout (keeps profile, drops privy pointer)", () => {
    const home = tempHome();
    try {
      seededProfile(home);
      resetLocalState({
        home,
        env: {},
        session: true,
        profile: false,
        keys: false,
      });
      assert.equal(loadPrivySession(home), null);
      assert.ok(loadConfig(home));
      const op = loadOperator(home);
      assert.equal(op.label, "org.you");
      assert.equal(op.key, undefined);
      assert.equal(existsSync(join(home, "op.key")), true);
    } finally {
      clearPrivySession(home);
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("--keep-keys leaves op.key after profile wipe", () => {
    const home = tempHome();
    try {
      seededProfile(home);
      resetLocalState({
        home,
        env: {},
        session: true,
        profile: true,
        keys: false,
      });
      assert.equal(loadOperator(home), null);
      assert.equal(existsSync(join(home, "op.key")), true);
      assert.equal(existsSync(join(home, "keys", "you.laptop.key")), true);
    } finally {
      clearPrivySession(home);
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("opt-in OpenClaw key delete only removes .key files", () => {
    const home = tempHome();
    const oc = tempHome("clanker-oc-");
    try {
      seededProfile(home);
      mkdirSync(join(oc, "keys"), { recursive: true });
      writeFileSync(join(oc, "keys", "you.laptop.key"), "0xbot\n");
      writeFileSync(join(oc, "keys", "readme.txt"), "keep me\n");
      resetLocalState({
        home,
        env: { OPENCLAW_HOME: oc },
        session: true,
        profile: true,
        keys: true,
        openclawKeys: true,
      });
      assert.equal(existsSync(join(oc, "keys", "you.laptop.key")), false);
      assert.equal(existsSync(join(oc, "keys", "readme.txt")), true);
    } finally {
      clearPrivySession(home);
      rmSync(home, { recursive: true, force: true });
      rmSync(oc, { recursive: true, force: true });
    }
  });
});

describe("runReset", () => {
  it("refuses to delete without --yes when not a TTY", async () => {
    const home = tempHome();
    try {
      seededProfile(home);
      await assert.rejects(
        () => runReset([], { home, env: {}, stdinTTY: false }),
        /--yes/,
      );
      assert.ok(loadConfig(home));
    } finally {
      clearPrivySession(home);
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("--dry-run --json prints inspect without deleting", async () => {
    const home = tempHome();
    let printed = "";
    const orig = console.log;
    console.log = (...a) => {
      printed += a.join(" ") + "\n";
    };
    try {
      seededProfile(home);
      const { exitCode } = await runReset(["--dry-run", "--json"], {
        home,
        env: { OPERATOR_PRIVATE_KEY: "0x01" },
        stdinTTY: false,
      });
      assert.equal(exitCode, 0);
      const parsed = JSON.parse(printed.trim());
      assert.equal(parsed.dryRun, true);
      assert.equal(parsed.session.present, true);
      assert.ok(parsed.leftovers.some((l) => l.id === "OPERATOR_PRIVATE_KEY"));
      assert.ok(loadConfig(home));
    } finally {
      console.log = orig;
      clearPrivySession(home);
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("--yes --json deletes and reports leftovers", async () => {
    const home = tempHome();
    let printed = "";
    const orig = console.log;
    console.log = (...a) => {
      printed += a.join(" ") + "\n";
    };
    try {
      seededProfile(home);
      const { exitCode } = await runReset(["--yes", "--json"], {
        home,
        env: { OPERATOR_PRIVATE_KEY: "0x01" },
        stdinTTY: false,
      });
      assert.equal(exitCode, 0);
      const parsed = JSON.parse(printed.trim());
      assert.equal(parsed.dryRun, false);
      assert.equal(parsed.session.present, false);
      assert.equal(loadConfig(home), null);
      assert.ok(parsed.leftovers.some((l) => l.id === "OPERATOR_PRIVATE_KEY"));
    } finally {
      console.log = orig;
      clearPrivySession(home);
      rmSync(home, { recursive: true, force: true });
    }
  });
});

describe("doctor env_key", () => {
  it("warns when OPERATOR_PRIVATE_KEY is set", async () => {
    const home = tempHome("clanker-envkey-");
    try {
      initProfile("sepolia", { home, force: true });
      writeOperator({ label: "org.you", owner: OWNER }, home);
      const report = await runDoctorChecks({
        home,
        env: { OPERATOR_PRIVATE_KEY: "0x01" },
        spawn: () => ({ status: 1, error: new Error("no cast") }),
        fetchImpl: async () => ({ ok: true, status: 200 }),
        skipBalance: true,
      });
      const envKey = report.checks.find((c) => c.id === "env_key");
      assert.ok(envKey);
      assert.equal(envKey.level, "warn");
      assert.match(envKey.message, /OPERATOR_PRIVATE_KEY/);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});

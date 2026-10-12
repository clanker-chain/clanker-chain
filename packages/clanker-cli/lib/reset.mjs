/**
 * Inspect / clear local CLI + Privy session state for a repeatable newcomer path.
 *
 * Does not delete on-chain names, the Privy account, or browser cookies.
 * OpenClaw bot keys are listed as leftovers unless `--openclaw-keys`.
 */

import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import * as clack from "@clack/prompts";
import {
  clankerHome,
  clankerKeysDir,
  configPath,
  loadConfig,
  loadOperator,
  operatorPath,
  openclawKeysDir,
  writeOperator,
} from "./profile.mjs";
import { defaultOperatorKeyPath } from "./foundry.mjs";
import {
  clearPrivySession,
  loadPrivySession,
  locatePrivySession,
  privyKeychainAccount,
} from "./privy-session.mjs";
import { listOpenclawBotKeys } from "./setup-detect.mjs";
import { c, isInteractive, nextHint, printPlan } from "./ui.mjs";

/**
 * @param {string[]} argv
 */
export function parseResetFlags(argv) {
  let dryRun = false;
  let sessionOnly = false;
  let keepKeys = false;
  let openclawKeys = false;
  let yes = false;
  let json = false;
  let openclawHome = null;
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--dry-run") dryRun = true;
    else if (a === "--session") sessionOnly = true;
    else if (a === "--keep-keys") keepKeys = true;
    else if (a === "--openclaw-keys") openclawKeys = true;
    else if (a === "--yes" || a === "-y") yes = true;
    else if (a === "--json") json = true;
    else if (a === "--openclaw-home" && argv[i + 1]) openclawHome = argv[++i];
  }
  return {
    dryRun,
    session: true,
    profile: !sessionOnly,
    keys: !sessionOnly && !keepKeys,
    openclawKeys,
    yes,
    json,
    openclawHome,
  };
}

/**
 * @param {{ env?: NodeJS.ProcessEnv, openclawHome?: string|null, openclawKeysDir?: string }} [opts]
 */
export function resolveOpenclawKeysDir(opts = {}) {
  if (opts.openclawKeysDir) return opts.openclawKeysDir;
  const env = opts.env ?? process.env;
  const home = opts.openclawHome ?? env.OPENCLAW_HOME ?? null;
  if (home) return join(home, "keys");
  return openclawKeysDir();
}

/**
 * Snapshot of local CLI/Privy state (no secrets).
 *
 * @param {{
 *   home?: string,
 *   env?: NodeJS.ProcessEnv,
 *   openclawHome?: string|null,
 *   openclawKeysDir?: string,
 * }} [opts]
 */
export function inspectLocalState(opts = {}) {
  const env = opts.env ?? process.env;
  const home = opts.home ?? clankerHome(env);
  const ocKeysDir = resolveOpenclawKeysDir({
    env,
    openclawHome: opts.openclawHome,
    openclawKeysDir: opts.openclawKeysDir,
  });
  const config = loadConfig(home);
  const operator = loadOperator(home);
  const session = loadPrivySession(home);
  const sessionStorage = locatePrivySession(home);
  const opKeyPath = defaultOperatorKeyPath(home);
  const keysDir = clankerKeysDir(env, home);
  const sessionFile = join(home, "privy-session.json");

  /** @type {{ kind: string, path: string }[]} */
  const files = [];
  if (existsSync(configPath(home))) {
    files.push({ kind: "config", path: configPath(home) });
  }
  if (existsSync(operatorPath(home))) {
    files.push({ kind: "operator", path: operatorPath(home) });
  }
  if (existsSync(sessionFile)) {
    files.push({ kind: "session-file", path: sessionFile });
  }
  if (existsSync(opKeyPath)) {
    files.push({ kind: "op.key", path: opKeyPath });
  }
  if (existsSync(keysDir)) {
    files.push({ kind: "keys", path: keysDir });
  }

  /** @type {{ id: string, blocking: boolean, message: string }[]} */
  const leftovers = [];
  if (env.OPERATOR_PRIVATE_KEY) {
    leftovers.push({
      id: "OPERATOR_PRIVATE_KEY",
      blocking: true,
      message:
        "OPERATOR_PRIVATE_KEY is set in this shell and wins over Privy. Run: unset OPERATOR_PRIVATE_KEY",
    });
  }
  if (env.PRIVY_APP_ID) {
    leftovers.push({
      id: "PRIVY_APP_ID",
      blocking: true,
      message:
        "PRIVY_APP_ID is set — the CLI will not use the production /join app until you unset it",
    });
  }
  const ocKeys = listOpenclawBotKeys({ openclawDir: ocKeysDir });
  if (ocKeys.length) {
    leftovers.push({
      id: "openclaw-keys",
      blocking: false,
      message: `${ocKeys.length} OpenClaw bot key(s) in ${ocKeysDir} (not removed unless --openclaw-keys)`,
    });
  }

  const notes = [
    {
      id: "browser",
      message:
        "Browser Privy login is unchanged — use a private window for a first-time /authorize",
    },
    {
      id: "chain",
      message:
        "On-chain names stay minted — pick a new unused label for a newcomer mint",
    },
  ];

  return {
    home,
    keychainAccount: privyKeychainAccount(home),
    session: session
      ? {
          present: true,
          storage: sessionStorage,
          address: session.address,
          walletId: session.walletId,
        }
      : { present: false, storage: sessionStorage, address: null, walletId: null },
    profile: {
      config: Boolean(config),
      preset: config?.preset ?? null,
      operator: Boolean(operator),
      label: operator?.label ?? null,
      owner: operator?.owner ?? null,
      keyType: operator?.key?.type ?? null,
    },
    files,
    leftovers,
    notes,
    openclawKeysDir: ocKeysDir,
    openclawBotKeys: ocKeys,
  };
}

/**
 * @param {ReturnType<typeof inspectLocalState>} inspect
 * @param {{ session?: boolean, profile?: boolean, keys?: boolean, openclawKeys?: boolean }} flags
 */
export function planReset(inspect, flags) {
  /** @type {{ kind: string, path: string }[]} */
  const targets = [];
  if (flags.session) {
    if (inspect.session.present && inspect.session.storage === "keychain") {
      targets.push({
        kind: "keychain",
        path: `keychain:${inspect.keychainAccount}`,
      });
    }
    for (const f of inspect.files) {
      if (f.kind === "session-file") targets.push(f);
    }
  }
  if (flags.profile) {
    for (const f of inspect.files) {
      if (f.kind === "config" || f.kind === "operator") targets.push(f);
    }
  }
  if (flags.keys) {
    for (const f of inspect.files) {
      if (f.kind === "op.key" || f.kind === "keys") targets.push(f);
    }
  }
  if (flags.openclawKeys) {
    for (const name of inspect.openclawBotKeys) {
      targets.push({
        kind: "openclaw-key",
        path: join(inspect.openclawKeysDir, `${name}.key`),
      });
    }
  }
  return targets;
}

/**
 * Apply a local reset. Safe to call from tests (no prompts).
 *
 * @param {{
 *   home?: string,
 *   env?: NodeJS.ProcessEnv,
 *   openclawHome?: string|null,
 *   openclawKeysDir?: string,
 *   session?: boolean,
 *   profile?: boolean,
 *   keys?: boolean,
 *   openclawKeys?: boolean,
 *   dryRun?: boolean,
 * }} [opts]
 */
export function resetLocalState(opts = {}) {
  const env = opts.env ?? process.env;
  const home = opts.home ?? clankerHome(env);
  const session = opts.session !== false;
  const profile = Boolean(opts.profile);
  const keys = Boolean(opts.keys);
  const openclawKeys = Boolean(opts.openclawKeys);
  const inspect = inspectLocalState({
    home,
    env,
    openclawHome: opts.openclawHome,
    openclawKeysDir: opts.openclawKeysDir,
  });
  const targets = planReset(inspect, {
    session,
    profile,
    keys,
    openclawKeys,
  });

  /** @type {string[]} */
  const removed = [];
  if (!opts.dryRun) {
    if (session) {
      const hadKeychain =
        inspect.session.present && inspect.session.storage === "keychain";
      const sessionFile = inspect.files.find((f) => f.kind === "session-file");
      clearPrivySession(home);
      if (hadKeychain) {
        removed.push(`keychain:${inspect.keychainAccount}`);
      }
      if (sessionFile) {
        removed.push(sessionFile.path);
      }
      stripPrivyPointer(home);
    }
    if (profile) {
      removeIfExists(configPath(home), removed);
      removeIfExists(operatorPath(home), removed);
    }
    if (keys) {
      removeIfExists(defaultOperatorKeyPath(home), removed);
      removeIfExists(clankerKeysDir(env, home), removed);
    }
    if (openclawKeys) {
      for (const name of inspect.openclawBotKeys) {
        removeIfExists(join(inspect.openclawKeysDir, `${name}.key`), removed);
      }
    }
  }

  const after = opts.dryRun
    ? inspect
    : inspectLocalState({
        home,
        env,
        openclawHome: opts.openclawHome,
        openclawKeysDir: opts.openclawKeysDir,
      });

  return {
    ok: true,
    dryRun: Boolean(opts.dryRun),
    home,
    removed: opts.dryRun ? [] : unique(removed),
    wouldRemove: targets.map((t) => t.path),
    leftovers: after.leftovers,
    notes: after.notes,
    inspect: after,
  };
}

/**
 * @param {string[]} argv
 * @param {{
 *   home?: string,
 *   env?: NodeJS.ProcessEnv,
 *   stdinTTY?: boolean,
 * }} [opts]
 */
export async function runReset(argv = [], opts = {}) {
  const flags = parseResetFlags(argv);
  const env = opts.env ?? process.env;
  const home = opts.home ?? clankerHome(env);
  const inspect = inspectLocalState({
    home,
    env,
    openclawHome: flags.openclawHome,
  });
  const applyFlags = {
    session: flags.session,
    profile: flags.profile,
    keys: flags.keys,
    openclawKeys: flags.openclawKeys,
  };
  const targets = planReset(inspect, applyFlags);
  const interactive = isInteractive(argv, { stdinTTY: opts.stdinTTY });

  if (!flags.dryRun && !flags.yes && !interactive) {
    throw new Error(
      "Non-interactive reset requires --yes to delete, or --dry-run to inspect",
    );
  }

  const planRows = resetPlanRows(inspect, targets, applyFlags);

  if (flags.dryRun) {
    const result = resetLocalState({
      home,
      env,
      openclawHome: flags.openclawHome,
      ...applyFlags,
      dryRun: true,
    });
    if (flags.json) {
      console.log(JSON.stringify(jsonPayload(result, inspect, targets), null, 2));
    } else {
      console.log(c.bold("clanker reset --dry-run"));
      printPlan(planRows, "Would remove");
      printLeftovers(inspect.leftovers, inspect.notes);
      nextHint([
        "clanker reset --yes          # delete the local profile + Privy session",
        "export CLANKER_HOME=$HOME/.clanker-newcomer   # sandbox instead of wiping ~/.clanker",
        "clanker login",
      ]);
    }
    return { exitCode: 0, ...result };
  }

  if (interactive) {
    printPlan(planRows, "Reset");
    const ok = await clack.confirm({
      message:
        "Delete this local CLI state? On-chain names and your Privy account stay.",
      initialValue: false,
    });
    if (clack.isCancel(ok) || ok === false) {
      clack.cancel("Aborted.");
      return { exitCode: 1, aborted: true, home };
    }
  } else if (!flags.json) {
    printPlan(planRows, "Reset");
  }

  const result = resetLocalState({
    home,
    env,
    openclawHome: flags.openclawHome,
    ...applyFlags,
  });

  if (flags.json) {
    console.log(JSON.stringify(jsonPayload(result, result.inspect, targets), null, 2));
  } else {
    console.log(c.bold("clanker reset"));
    if (result.removed.length) {
      console.log(c.green(`Cleared ${result.removed.length} local item(s).`));
      for (const p of result.removed) {
        console.log(c.dim(`  ${p}`));
      }
    } else {
      console.log(c.dim("Nothing local to clear."));
    }
    printLeftovers(result.leftovers, result.notes);
    nextHint([
      "unset OPERATOR_PRIVATE_KEY PRIVY_APP_ID   # if listed above",
      "clanker login",
      "clanker setup --preset sepolia --operator org.you --yes",
    ]);
  }
  return { exitCode: 0, ...result };
}

function stripPrivyPointer(home) {
  const operator = loadOperator(home);
  if (operator?.key?.type !== "privy") return;
  writeOperator(
    {
      label: operator.label,
      owner: operator.owner,
      key: null,
    },
    home,
  );
}

function removeIfExists(path, removed) {
  if (!existsSync(path)) return;
  rmSync(path, { recursive: true, force: true });
  removed.push(path);
}

function unique(list) {
  return [...new Set(list)];
}

function resetPlanRows(inspect, targets, flags) {
  const rows = [
    ["home", inspect.home],
    ["session", flags.session ? (inspect.session.present ? inspect.session.storage || "yes" : "none") : "keep"],
    ["profile", flags.profile ? (inspect.profile.config || inspect.profile.operator ? "config + operator.json" : "none") : "keep"],
    ["keys", flags.keys ? "op.key + keys/" : "keep"],
    ["openclaw", flags.openclawKeys ? `${inspect.openclawBotKeys.length} bot key(s)` : "keep"],
    ["items", targets.length ? String(targets.length) : "0"],
  ];
  return rows;
}

function printLeftovers(leftovers, notes) {
  const blocking = leftovers.filter((l) => l.blocking);
  const other = leftovers.filter((l) => !l.blocking);
  if (blocking.length) {
    console.log("");
    console.log(c.yellow("Still in this shell (CLI cannot unset these):"));
    for (const l of blocking) {
      console.log(`  ${l.message}`);
    }
  }
  if (other.length || notes?.length) {
    console.log("");
    console.log(c.dim("Not cleared:"));
    for (const l of other) {
      console.log(c.dim(`  ${l.message}`));
    }
    for (const n of notes ?? []) {
      console.log(c.dim(`  ${n.message}`));
    }
  }
}

function jsonPayload(result, inspect, targets) {
  return {
    ok: result.ok,
    dryRun: result.dryRun,
    home: result.home,
    removed: result.removed,
    wouldRemove: targets.map((t) => t.path),
    leftovers: result.leftovers,
    notes: result.notes,
    session: inspect.session,
    profile: inspect.profile,
  };
}

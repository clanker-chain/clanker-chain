#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import os from "node:os";
import process from "node:process";
import { getAddress } from "viem";
import {
  ANVIL_DEFAULT_PRIVATE_KEY,
  harnessSnippet,
  initProfile,
  isLocalRpc,
  loadConfig,
  loadOperator,
} from "../lib/profile.mjs";
import {
  findBotsByOperator,
  findOperatorsByOwner,
  labelToId,
  pickOperatorLabel,
  publicClientFromRpc,
  readBot,
  resolvePreferredOperator,
} from "../lib/identity-query.mjs";
import { resolveForRead, resolveOperatorKey, resolveReadIdentity } from "../lib/resolve.mjs";
import { runSetup } from "../lib/setup.mjs";
import { runDoctor } from "../lib/doctor.mjs";
import {
  c,
  confirmPlan,
  exitCliError,
  nextHint,
} from "../lib/ui.mjs";

function resolveFoundryBinary(name) {
  const home = os.homedir();
  const candidates = [
    join(home, ".foundry", "bin", name),
    join("/opt/homebrew", "bin", name),
    join("/usr/local", "bin", name),
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  const which = spawnSync("which", [name], { encoding: "utf8" });
  if (which.status === 0 && which.stdout?.trim()) {
    return which.stdout.trim();
  }
  return name;
}

function parseChainFlags(argv, defaults) {
  const out = { ...defaults };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--port" && argv[i + 1]) {
      out.port = argv[++i];
    } else if (a === "--host" && argv[i + 1]) {
      out.host = argv[++i];
    } else if (a === "--state" && argv[i + 1]) {
      out.state = argv[++i];
    } else if (a === "--rpc" && argv[i + 1]) {
      out.rpc = argv[++i];
    } else if (a === "--key" && argv[i + 1]) {
      out.key = argv[++i];
    }
  }
  return out;
}

function hasFlag(argv, name) {
  return argv.includes(name);
}

function flagValue(argv, name) {
  const i = argv.indexOf(name);
  if (i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--")) return argv[i + 1];
  return null;
}

function runScript(scriptPath, args = []) {
  const result = spawnSync(scriptPath, args, {
    stdio: "inherit",
    shell: false,
  });
  if (result.error) {
    console.error(result.error.message);
    process.exit(result.status ?? 1);
  }
  process.exit(result.status ?? 0);
}

function findRepoRoot() {
  const here = dirname(new URL(import.meta.url).pathname);
  return dirname(dirname(here));
}

/** chain up/deploy and check * need the monorepo; npm installs only ship bin/ + lib/. */
function requireMonorepo(repoRoot, relativePath) {
  const target = join(repoRoot, relativePath);
  if (!existsSync(target)) {
    console.error(
      `This command requires a clanker-chain git checkout (missing ${relativePath}). ` +
        "Operator commands (init, whoami, operator, bot) work from the npm package; " +
        "chain up/deploy and check need the monorepo.",
    );
    process.exit(1);
  }
  return target;
}

function printJson(obj) {
  console.log(JSON.stringify(obj, (_, v) => (typeof v === "bigint" ? v.toString() : v), 2));
}

function printHumanWhoami(data) {
  console.log(`address:  ${data.address}`);
  console.log(`source:   ${data.source}`);
  console.log(`rpc:      ${data.rpc}`);
  console.log(`registry: ${data.registry}`);
  if (!data.operators.length) {
    console.log("operators: (none)");
    return;
  }
  console.log("operators:");
  for (const op of data.operators) {
    const status = op.active ? "active" : "revoked";
    console.log(`  - ${op.label}  [${status}]  owner=${op.owner}`);
    if (op.bots?.length) {
      for (const b of op.bots) {
        const bs = b.active ? "active" : "revoked";
        console.log(`      bot ${b.label}  [${bs}]  key=${b.botKey}`);
      }
    }
  }
}

function printHumanBots(data) {
  console.log(`operator: ${data.operator}`);
  if (!data.bots.length) {
    console.log("bots: (none)");
    return;
  }
  for (const b of data.bots) {
    const status = b.active ? "active" : "revoked";
    console.log(`  ${b.label}  [${status}]  key=${b.botKey}  registeredAt=${b.registeredAt}`);
  }
}

function usage() {
  console.log(`clanker - clanker-chain helper CLI

Usage:
  clanker setup [--preset sepolia|local] [--operator <label>] [--address 0x…] [--key-file path] [--force]
  clanker doctor [--json]
  clanker init --preset sepolia|local [--force]
  clanker whoami [--json] [--operator <label>] [--address 0x…] [--with-bots]
  clanker operator mint <label> [--json] [--yes]
  clanker operator transfer propose <label> <newOwner> [--yes]
  clanker operator transfer accept <label> [--yes]
  clanker bot mint <label> [operator] [--json] [--yes]
  clanker bots [--json] [--operator <label>] [--address 0x…]
  clanker bot status <label> [--json]
  clanker bot revoke <label> [--json] [--yes]
  clanker bot rotate <label> <newKeyAddress> [--json] [--yes]
  clanker init-openclaw
  clanker chain up|deploy|mint-operator|mint-bot|rotate-bot-key|revoke-bot ...
  clanker check mqtt <bot_id> <operator_id>
  clanker check identity [operator_id]

Profile:
  ~/.clanker/config.json     network preset (registry, RPC, broker URLs)
  ~/.clanker/operator.json   label + owner + optional key pointer (never raw hex)
  ~/.clanker/keys/           bot keys (also written to ~/.openclaw/keys/)

Humans: \`clanker setup\` then \`clanker doctor\` / \`whoami\`.
Mutates print a plan and confirm unless --yes or --json.
whoami is fast by default; pass --with-bots to enrich child bots (or use \`clanker bots\`).

See docs/operator-cli.md.
`);
}

/**
 * Infer operator label from profile / whoami / flag.
 * Preferred label uses storage read (works after OperatorTransferred).
 */
async function resolveOperatorLabel(argv, address, network) {
  const preferred =
    flagValue(argv, "--operator") ?? loadOperator(network.home)?.label ?? null;
  const pub = await publicClientFromRpc(network.rpc);

  if (preferred) {
    const resolved = await resolvePreferredOperator(pub, {
      registry: network.registry,
      label: preferred,
      owner: getAddress(address),
    });
    if (resolved.error) {
      const err = new Error(resolved.error);
      err.candidates = resolved.candidates;
      throw err;
    }
    return { label: resolved.operator.label, operators: [resolved.operator], pub };
  }

  const operators = await findOperatorsByOwner(pub, {
    registry: network.registry,
    owner: getAddress(address),
    fromBlock: network.fromBlock,
  });
  const pick = pickOperatorLabel({ operators, preferred: null });
  if (pick.error) {
    const err = new Error(pick.error);
    err.candidates = pick.candidates;
    throw err;
  }
  return { label: pick.label, operators, pub };
}

async function cmdWhoami(argv) {
  let address;
  let source;
  let network;
  try {
    const resolved = resolveReadIdentity(argv);
    address = resolved.address;
    source = resolved.source;
    network = resolved.network;
  } catch (err) {
    exitCliError({
      error: err.message,
      because: "whoami needs an owner address from --address, a key, or operator.json",
      try: ["clanker setup", "clanker doctor", "clanker whoami --address 0x…"],
    });
  }

  const withBots = hasFlag(argv, "--with-bots");
  const pub = await publicClientFromRpc(network.rpc);
  const preferred =
    flagValue(argv, "--operator") ?? loadOperator(network.home)?.label ?? null;

  let selected;
  if (preferred) {
    const resolved = await resolvePreferredOperator(pub, {
      registry: network.registry,
      label: preferred,
      owner: getAddress(address),
    });
    if (resolved.error) {
      exitCliError({
        error: resolved.error,
        because: "preferred operator label did not match this owner on-chain",
        try: [
          "clanker whoami --address 0x…",
          "clanker setup --force   # fix label/owner",
        ],
      });
    }
    selected = [resolved.operator];
  } else {
    selected = await findOperatorsByOwner(pub, {
      registry: network.registry,
      owner: getAddress(address),
      fromBlock: network.fromBlock,
    });
  }

  if (withBots) {
    for (const op of selected) {
      op.bots = await findBotsByOperator(pub, {
        registry: network.registry,
        operatorId: op.id,
        fromBlock: network.fromBlock,
      });
    }
  }

  const data = {
    ok: true,
    address,
    source,
    rpc: network.rpc,
    registry: network.registry,
    operators: selected.map((o) => ({
      label: o.label,
      id: o.id,
      owner: o.owner,
      active: o.active,
      registeredAt: o.registeredAt.toString(),
      revokedAt: o.revokedAt.toString(),
      bots: withBots
        ? (o.bots ?? []).map((b) => ({
            label: b.label,
            botKey: b.botKey,
            active: b.active,
            registeredAt: b.registeredAt.toString(),
            revokedAt: b.revokedAt.toString(),
          }))
        : [],
    })),
  };

  if (hasFlag(argv, "--json")) printJson(data);
  else {
    printHumanWhoami(data);
    if (!withBots && data.operators.length) {
      console.log(c.dim("(bots omitted — pass --with-bots or run clanker bots)"));
    }
    nextHint(["clanker bots", "clanker doctor"]);
  }
}

async function cmdBots(argv) {
  let address;
  let network;
  try {
    const resolved = resolveReadIdentity(argv);
    address = resolved.address;
    network = resolved.network;
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
  const { label, pub } = await resolveOperatorLabel(argv, address, network);
  const bots = await findBotsByOperator(pub, {
    registry: network.registry,
    operatorId: labelToId(label),
    fromBlock: network.fromBlock,
  });
  const data = {
    ok: true,
    operator: label,
    bots: bots.map((b) => ({
      label: b.label,
      botKey: b.botKey,
      active: b.active,
      registeredAt: b.registeredAt.toString(),
      revokedAt: b.revokedAt.toString(),
      mintTx: b.mintTx,
    })),
  };
  if (hasFlag(argv, "--json")) printJson(data);
  else printHumanBots(data);
}

async function cmdBotStatus(botLabel, argv) {
  const network = resolveForRead(argv);
  const pub = await publicClientFromRpc(network.rpc);
  const bot = await readBot(pub, network.registry, botLabel);
  const data = {
    ok: bot.registeredAt > 0n,
    label: bot.label,
    botKey: bot.botKey,
    operatorId: bot.operatorId,
    active: bot.active,
    registeredAt: bot.registeredAt.toString(),
    revokedAt: bot.revokedAt.toString(),
  };
  if (!data.ok) {
    if (hasFlag(argv, "--json")) printJson({ ok: false, error: "bot not registered", label: botLabel });
    else console.error(`Bot not registered: ${botLabel}`);
    process.exit(1);
  }
  if (hasFlag(argv, "--json")) printJson(data);
  else {
    console.log(`label:        ${data.label}`);
    console.log(`botKey:       ${data.botKey}`);
    console.log(`active:       ${data.active}`);
    console.log(`registeredAt: ${data.registeredAt}`);
    console.log(`revokedAt:    ${data.revokedAt}`);
  }
}

async function main() {
  const [, , cmd, ...rest] = process.argv;

  if (!cmd || cmd === "-h" || cmd === "--help") {
    usage();
    process.exit(0);
  }

  const repoRoot = findRepoRoot();

  if (cmd === "setup") {
    try {
      await runSetup(rest);
    } catch (err) {
      exitCliError({
        error: err.message,
        because: "setup could not write a valid local profile",
        try: [
          "clanker setup --preset sepolia --operator org.you --address 0x… --yes --force",
          "clanker doctor",
        ],
      });
    }
    return;
  }

  if (cmd === "doctor") {
    const { exitCode } = await runDoctor(rest);
    process.exit(exitCode);
  }

  if (cmd === "init") {
    const preset = flagValue(rest, "--preset") ?? rest.find((a) => !a.startsWith("--"));
    if (!preset || preset === "init") {
      console.error("Usage: clanker init --preset sepolia|local [--force]");
      process.exit(1);
    }
    const force = hasFlag(rest, "--force");
    const registryOverride = flagValue(rest, "--registry");
    try {
      const { path, config } = initProfile(preset, {
        force,
        registryAddress: registryOverride ?? undefined,
      });
      console.log(`Wrote ${path}`);
      printJson(config);
    } catch (err) {
      console.error(err.message);
      process.exit(1);
    }
    return;
  }

  if (cmd === "whoami") {
    await cmdWhoami(rest);
    return;
  }

  if (cmd === "bots") {
    await cmdBots(rest);
    return;
  }

  if (cmd === "operator") {
    const [sub, ...opArgv] = rest;
    const {
      chainMintOperator,
      chainProposeOperatorTransfer,
      chainAcceptOperatorTransfer,
    } = await import("./chain-identity.mjs");

    if (sub === "mint") {
      const [label, ...flags] = opArgv;
      if (!label || label.startsWith("--")) {
        console.error("Usage: clanker operator mint <label>");
        process.exit(1);
      }
      let planRows;
      try {
        const preview = resolveOperatorKey(flags);
        planRows = [
          ["action", "registerOperator"],
          ["label", label],
          ["owner", preview.address],
          ["rpc", preview.network.rpc],
          ["registry", preview.network.registry ?? "(none)"],
          ["key", preview.source],
        ];
      } catch (err) {
        exitCliError({
          error: err.message,
          because: "operator mint needs a signing key on this network",
          try: [
            "export OPERATOR_PRIVATE_KEY=0x…",
            "clanker operator mint " + label + " --key-file ~/.clanker/op.key --yes",
            "clanker doctor",
          ],
        });
      }
      const ok = await confirmPlan(flags, planRows, `Mint operator ${label}?`);
      if (!ok) process.exit(0);
      const result = await chainMintOperator(label, flags);
      if (hasFlag(flags, "--json") || hasFlag(opArgv, "--json")) printJson(result);
      else {
        console.log(c.green(`Minted operator ${label}`));
        console.log(`owner: ${result.owner}`);
        console.log(`tx:    ${result.tx}`);
        console.log(`Wrote ~/.clanker/operator.json`);
        nextHint([`clanker bot mint <bot_label>`, "clanker whoami"]);
      }
      return;
    }

    if (sub === "transfer") {
      const [action, label, newOwner, ...flags] = opArgv;
      if (action === "propose") {
        if (!label || !newOwner) {
          console.error("Usage: clanker operator transfer propose <label> <newOwner>");
          process.exit(1);
        }
        const ok = await confirmPlan(
          flags,
          [
            ["action", "proposeOperatorTransfer"],
            ["label", label],
            ["newOwner", getAddress(newOwner)],
          ],
          `Propose transfer of ${label}?`,
        );
        if (!ok) process.exit(0);
        const result = await chainProposeOperatorTransfer(label, getAddress(newOwner), flags);
        if (hasFlag(flags, "--json")) printJson(result);
        else {
          console.log(c.green(`Proposed transfer of ${label} → ${newOwner}`));
          console.log(`tx: ${result.tx}`);
          nextHint([`clanker operator transfer accept ${label}   # as new owner`]);
        }
        return;
      }
      if (action === "accept") {
        if (!label) {
          console.error("Usage: clanker operator transfer accept <label>");
          process.exit(1);
        }
        const ok = await confirmPlan(
          flags,
          [
            ["action", "acceptOperatorTransfer"],
            ["label", label],
          ],
          `Accept transfer of ${label}?`,
        );
        if (!ok) process.exit(0);
        const result = await chainAcceptOperatorTransfer(label, flags);
        if (hasFlag(flags, "--json")) printJson(result);
        else {
          console.log(c.green(`Accepted transfer of ${label}`));
          console.log(`owner: ${result.owner}`);
          console.log(`tx: ${result.tx}`);
          nextHint(["clanker whoami", "clanker bots"]);
        }
        return;
      }
      console.error("Usage: clanker operator transfer propose|accept ...");
      process.exit(1);
    }

    console.error("Usage: clanker operator mint|transfer ...");
    process.exit(1);
  }

  if (cmd === "bot") {
    const [sub, ...botArgv] = rest;
    const {
      chainMintBot,
      chainRotateBotKey,
      chainRevokeBot,
    } = await import("./chain-identity.mjs");

    if (sub === "mint") {
      const positionals = [];
      const flags = [];
      for (let i = 0; i < botArgv.length; i += 1) {
        const a = botArgv[i];
        if (a.startsWith("--")) {
          flags.push(a);
          if (botArgv[i + 1] && !botArgv[i + 1].startsWith("--") && a !== "--json") {
            flags.push(botArgv[++i]);
          }
        } else {
          positionals.push(a);
        }
      }
      const [botLabel, operatorArg] = positionals;
      if (!botLabel) {
        console.error("Usage: clanker bot mint <label> [operator]");
        process.exit(1);
      }
      let operatorLabel = operatorArg ?? flagValue(flags, "--operator") ?? null;
      if (!operatorLabel) {
        try {
          const { address, network } = resolveOperatorKey(flags);
          const inferred = await resolveOperatorLabel(flags, address, network);
          operatorLabel = inferred.label;
        } catch (err) {
          exitCliError({
            error: err.message,
            because: "bot mint needs an operator label or a resolvable signing key",
            try: [
              `clanker bot mint ${botLabel} <operator_label> --yes`,
              "clanker setup",
            ],
          });
        }
      }
      const ok = await confirmPlan(
        flags,
        [
          ["action", "registerBot"],
          ["bot", botLabel],
          ["operator", operatorLabel],
        ],
        `Mint bot ${botLabel} under ${operatorLabel}?`,
      );
      if (!ok) process.exit(0);
      const result = await chainMintBot(botLabel, operatorLabel, flags);
      if (hasFlag(flags, "--json")) printJson(result);
      else {
        console.log(c.green(`Minted bot ${botLabel} under ${operatorLabel}`));
        console.log(`botKey:   ${result.bot_key}`);
        console.log(`key file: ${result.key_path}`);
        console.log(`also:     ${result.clanker_key_path}`);
        console.log(`tx:       ${result.tx}`);
        console.log("\nchannels.mqtt stub:");
        console.log(JSON.stringify(result.channels_mqtt, null, 2));
        nextHint([
          "Paste channels.mqtt into openclaw.json",
          "openclaw plugins install @clanker-chain/mqtt-channel-plugin@…",
        ]);
      }
      return;
    }

    if (sub === "revoke") {
      const [botLabel, ...flags] = botArgv;
      if (!botLabel) {
        console.error("Usage: clanker bot revoke <label>");
        process.exit(1);
      }
      const ok = await confirmPlan(
        flags,
        [
          ["action", "revokeBot"],
          ["bot", botLabel],
        ],
        `Revoke bot ${botLabel}?`,
      );
      if (!ok) process.exit(0);
      const result = await chainRevokeBot(botLabel, flags);
      if (hasFlag(flags, "--json")) printJson(result);
      else {
        console.log(c.yellow(`Revoked ${botLabel}`));
        console.log(`tx: ${result.tx}`);
        nextHint(["clanker bots", "clanker bot status " + botLabel]);
      }
      return;
    }

    if (sub === "rotate") {
      const [botLabel, newKey, ...flags] = botArgv;
      if (!botLabel || !newKey) {
        console.error("Usage: clanker bot rotate <label> <newKeyAddress>");
        process.exit(1);
      }
      const ok = await confirmPlan(
        flags,
        [
          ["action", "rotateBotKey"],
          ["bot", botLabel],
          ["newKey", getAddress(newKey)],
        ],
        `Rotate key for ${botLabel}?`,
      );
      if (!ok) process.exit(0);
      const result = await chainRotateBotKey(botLabel, getAddress(newKey), flags);
      if (hasFlag(flags, "--json")) printJson(result);
      else {
        console.log(c.green(`Rotated ${botLabel} → ${newKey}`));
        console.log(`tx: ${result.tx}`);
        nextHint(["Update ~/.openclaw/keys/" + botLabel + ".key", "clanker bot status " + botLabel]);
      }
      return;
    }

    if (sub === "status") {
      const [botLabel, ...flags] = botArgv;
      if (!botLabel) {
        console.error("Usage: clanker bot status <label>");
        process.exit(1);
      }
      await cmdBotStatus(botLabel, flags);
      return;
    }

    console.error("Usage: clanker bot mint|revoke|rotate|status ...");
    process.exit(1);
  }

  if (cmd === "chain") {
    const [sub, ...chainArgv] = rest;
    if (!sub || sub === "-h" || sub === "--help") {
      console.error(
        "Usage: clanker chain up | deploy | mint-operator | mint-bot | rotate-bot-key | revoke-bot",
      );
      process.exit(1);
    }

    const {
      chainMintOperator,
      chainMintBot,
      chainRotateBotKey,
      chainRevokeBot,
    } = await import("./chain-identity.mjs");

    if (sub === "up") {
      requireMonorepo(repoRoot, "chain");
      const flags = parseChainFlags(chainArgv, {
        host: "0.0.0.0",
        port: "8545",
        state: join(repoRoot, "chain", ".anvil-state.json"),
      });
      const anvil = resolveFoundryBinary("anvil");
      if (!existsSync(anvil) && anvil === "anvil") {
        console.error(
          "anvil not found on PATH. Install Foundry: https://book.getfoundry.sh/getting-started/installation",
        );
        process.exit(1);
      }
      const stateDir = dirname(flags.state);
      if (!existsSync(stateDir)) {
        mkdirSync(stateDir, { recursive: true });
      }
      const result = spawnSync(
        anvil,
        ["--host", flags.host, "--port", flags.port, "--state", flags.state],
        { stdio: "inherit", cwd: repoRoot, shell: false },
      );
      if (result.error) {
        console.error(result.error.message);
        process.exit(result.status ?? 1);
      }
      process.exit(result.status ?? 0);
    }

    if (sub === "deploy") {
      // Anvil-guarded key: default Anvil #0 only on local RPC.
      const rpcFlag = flagValue(chainArgv, "--rpc") ?? "http://127.0.0.1:8545";
      let deployKey;
      try {
        const resolved = resolveOperatorKey(chainArgv, {
          rpc: rpcFlag,
          requireRegistry: false,
        });
        deployKey = resolved.key;
      } catch (err) {
        if (isLocalRpc(rpcFlag) && !flagValue(chainArgv, "--key") && !process.env.OPERATOR_PRIVATE_KEY) {
          deployKey = ANVIL_DEFAULT_PRIVATE_KEY;
        } else {
          console.error(err.message);
          process.exit(1);
        }
      }
      const forge = resolveFoundryBinary("forge");
      if (!existsSync(forge) && forge === "forge") {
        console.error(
          "forge not found on PATH. Install Foundry: https://book.getfoundry.sh/getting-started/installation",
        );
        process.exit(1);
      }
      const chainDir = requireMonorepo(repoRoot, "chain");
      const result = spawnSync(
        forge,
        [
          "script",
          "script/Deploy.s.sol:Deploy",
          "--rpc-url",
          rpcFlag,
          "--private-key",
          deployKey,
          "--broadcast",
          "-vvv",
        ],
        { cwd: chainDir, encoding: "utf8", stdio: "pipe", shell: false },
      );
      const combined = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
      const match = combined.match(/ClankerIdentity deployed at:\s*(0x[a-fA-F0-9]{40})/);
      if (match) {
        console.log(`Deployed ClankerIdentity at ${match[1]}`);
      } else {
        console.log(combined);
        if (result.status === 0) {
          console.warn(
            "[clanker] Could not parse deployed address from forge output; see logs above.",
          );
        }
      }
      if (result.error) {
        console.error(result.error.message);
        process.exit(result.status ?? 1);
      }
      process.exit(result.status ?? 0);
    }

    if (sub === "mint-operator") {
      const [label, ...flags] = chainArgv;
      if (!label) {
        console.error("chain mint-operator requires <label>");
        process.exit(1);
      }
      const result = await chainMintOperator(label, flags);
      printJson(result);
      return;
    }

    if (sub === "mint-bot") {
      const [botLabel, operatorLabel, ...flags] = chainArgv;
      if (!botLabel || !operatorLabel) {
        console.error("chain mint-bot requires <bot_label> <operator_label>");
        process.exit(1);
      }
      const result = await chainMintBot(botLabel, operatorLabel, flags);
      printJson(result);
      return;
    }

    if (sub === "rotate-bot-key") {
      const [botLabel, newKey, ...flags] = chainArgv;
      if (!botLabel || !newKey) {
        console.error("chain rotate-bot-key requires <bot_label> <new_key_address>");
        process.exit(1);
      }
      const result = await chainRotateBotKey(botLabel, newKey, flags);
      printJson(result);
      return;
    }

    if (sub === "revoke-bot") {
      const [botLabel, ...flags] = chainArgv;
      if (!botLabel) {
        console.error("chain revoke-bot requires <bot_label>");
        process.exit(1);
      }
      const result = await chainRevokeBot(botLabel, flags);
      printJson(result);
      return;
    }

    console.error(
      `Unknown chain subcommand: ${sub}. Use 'up', 'deploy', 'mint-operator', 'mint-bot', 'rotate-bot-key', or 'revoke-bot'.`,
    );
    process.exit(1);
  }

  if (cmd === "check") {
    const [sub, ...args] = rest;
    if (sub === "mqtt") {
      const [botId, operatorId] = args;
      if (!botId || !operatorId) {
        console.error("check mqtt requires <bot_id> <operator_id>");
        process.exit(1);
      }
      requireMonorepo(repoRoot, "scripts");
      const scriptPath = join(repoRoot, "scripts", "check-mqtt.sh");
      if (!existsSync(scriptPath)) {
        console.error(`check-mqtt.sh not found at ${scriptPath}`);
        process.exit(1);
      }
      runScript(scriptPath, [botId, operatorId]);
      return;
    }
    if (sub === "identity") {
      const [operatorId] = args;
      requireMonorepo(repoRoot, "scripts");
      const scriptPath = join(repoRoot, "scripts", "check-identity.sh");
      if (!existsSync(scriptPath)) {
        console.error(`check-identity.sh not found at ${scriptPath}`);
        process.exit(1);
      }
      runScript(scriptPath, operatorId ? [operatorId] : []);
      return;
    }
    console.error("Unknown check subcommand. Use 'mqtt' or 'identity'.");
    process.exit(1);
  }

  if (cmd === "init-openclaw") {
    const home = os.homedir();
    const openclawDir = join(home, ".openclaw");
    const cfgPath = join(openclawDir, "openclaw.json");
    if (!existsSync(openclawDir)) {
      mkdirSync(openclawDir, { recursive: true });
    }

    if (existsSync(cfgPath)) {
      console.log(`${cfgPath} already exists.`);
      console.log(
        'Ensure plugins.enabled includes "mqtt" and "mqtt-tools", and channels.mqtt has botId, operatorId, brokerUrl, chainRpcUrl, registryAddress.',
      );
      console.log("See SETUP.md and docs/operator-cli.md.");
      process.exit(0);
    }

    const profile = loadConfig();
    const operator = loadOperator();
    // No profile: local defaults only — do not mix Sepolia registry with localhost MQTT.
    const network = profile
      ? {
          rpc: profile.chainRpcUrl,
          registry: profile.registryAddress,
          brokerUrl: profile.brokerUrl,
          mqttAuthServiceUrl: profile.mqttAuthServiceUrl,
        }
      : {
          rpc: "http://127.0.0.1:8545",
          registry: null,
          brokerUrl: "mqtt://localhost:1883",
          mqttAuthServiceUrl: "http://localhost:9090",
        };

    const mqtt = harnessSnippet({
      botId: "openclaw.your-bot.local",
      operatorId: operator?.label ?? "org.openclaw.your-operator",
      network,
    });
    if (!mqtt.registryAddress) {
      mqtt.registryAddress = "0x0000000000000000000000000000000000000000";
    }

    const cfg = {
      plugins: {
        enabled: ["mqtt", "mqtt-tools"],
      },
      channels: {
        mqtt,
      },
    };
    writeFileSync(cfgPath, JSON.stringify(cfg, null, 2), "utf8");
    console.log(`Created ${cfgPath} with mqtt + mqtt-tools from ${profile ? "active" : "default"} preset.`);
    console.log("Next: clanker bot mint <label>, then set channels.mqtt.botId / operatorId.");
    console.log("See docs/operator-cli.md and SETUP.md.");
    process.exit(0);
  }

  console.error(`Unknown command: ${cmd}`);
  usage();
  process.exit(1);
}

main().catch((err) => {
  console.error(err?.message ?? String(err));
  if (err?.candidates?.length) {
    console.error(`Candidates: ${err.candidates.join(", ")}`);
  }
  process.exit(1);
});

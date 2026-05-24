#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import os from "node:os";
import process from "node:process";

/** Anvil account #0 — dev only; never use on a real chain. */
const ANVIL_DEFAULT_PRIVATE_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

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
  // Assume this CLI is installed from the clanker-chain repo; resolve relative to this file.
  const here = dirname(new URL(import.meta.url).pathname);
  // /path/to/clanker-chain/clanker-cli/bin -> /path/to/clanker-chain
  return dirname(dirname(here));
}

function usage() {
  console.log(`clanker - clanker-chain helper CLI

Usage:
  clanker init-openclaw
  clanker chain up [--host 0.0.0.0] [--port 8545] [--state <path>]
  clanker chain deploy [--rpc <url>] [--key <hex>]
  clanker chain mint-operator <label> [--rpc <url>] [--registry <addr>] [--key <hex>]
  clanker chain mint-bot <bot_label> <operator_label> [--bot-key <hex>] [--rpc ...] [--registry ...] [--key ...]
  clanker chain rotate-bot-key <bot_label> <new_key_address> [--rpc ...] [--registry ...] [--key ...]
  clanker chain revoke-bot <bot_label> [--rpc ...] [--registry ...] [--key ...]
  clanker check mqtt <bot_id> <operator_id>
  clanker check identity [operator_id]

Commands:
  init-openclaw           Wire clanker-chain-identity and clanker-chain-mqtt into the current OpenClaw repo (.env + basic config).
  chain up                Start local Anvil (Foundry). Default: --host 0.0.0.0 --port 8545 --state chain/.anvil-state.json under the repo root.
  chain deploy            Deploy ClankerIdentity via forge script (defaults: Anvil RPC + Anvil test account #0 key — dev only).
  chain mint-operator     Register an operator on ClankerIdentity (label = operator_id string).
  chain mint-bot          Register a bot; generates bot key unless --bot-key is set; writes ~/.openclaw/keys/<bot_label>.key.
  chain rotate-bot-key    Rotate bot signing key on-chain.
  chain revoke-bot        Revoke a bot on-chain.
  check mqtt              Run scripts/check-mqtt.sh with the given bot and operator ids.
  check identity          Run scripts/check-identity.sh for the given operator id (default: org.openclaw.operator).
`);
}

async function main() {
  const [, , cmd, ...rest] = process.argv;

  if (!cmd || cmd === "-h" || cmd === "--help") {
    usage();
    process.exit(0);
  }

  const repoRoot = findRepoRoot();

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
      const flags = parseChainFlags(chainArgv, {
        rpc: "http://127.0.0.1:8545",
        key: ANVIL_DEFAULT_PRIVATE_KEY,
      });
      const forge = resolveFoundryBinary("forge");
      if (!existsSync(forge) && forge === "forge") {
        console.error(
          "forge not found on PATH. Install Foundry: https://book.getfoundry.sh/getting-started/installation",
        );
        process.exit(1);
      }
      const chainDir = join(repoRoot, "chain");
      if (!existsSync(chainDir)) {
        console.error(`chain/ directory not found at ${chainDir}`);
        process.exit(1);
      }
      const result = spawnSync(
        forge,
        [
          "script",
          "script/Deploy.s.sol:Deploy",
          "--rpc-url",
          flags.rpc,
          "--private-key",
          flags.key,
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
      await chainMintOperator(label, flags);
      return;
    }

    if (sub === "mint-bot") {
      const [botLabel, operatorLabel, ...flags] = chainArgv;
      if (!botLabel || !operatorLabel) {
        console.error("chain mint-bot requires <bot_label> <operator_label>");
        process.exit(1);
      }
      await chainMintBot(botLabel, operatorLabel, flags);
      return;
    }

    if (sub === "rotate-bot-key") {
      const [botLabel, newKey, ...flags] = chainArgv;
      if (!botLabel || !newKey) {
        console.error("chain rotate-bot-key requires <bot_label> <new_key_address>");
        process.exit(1);
      }
      await chainRotateBotKey(botLabel, newKey, flags);
      return;
    }

    if (sub === "revoke-bot") {
      const [botLabel, ...flags] = chainArgv;
      if (!botLabel) {
        console.error("chain revoke-bot requires <bot_label>");
        process.exit(1);
      }
      await chainRevokeBot(botLabel, flags);
      return;
    }

    console.error(`Unknown chain subcommand: ${sub}. Use 'up', 'deploy', 'mint-operator', 'mint-bot', 'rotate-bot-key', or 'revoke-bot'.`);
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
    // Run from within an OpenClaw repo.
    const cwd = process.cwd();
    const envPath = join(cwd, ".env");
    let envContent = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";

    const extensionsMatch = envContent.match(/^OPENCLAW_EXTENSIONS=(.*)$/m);

    if (!extensionsMatch) {
      const line = 'OPENCLAW_EXTENSIONS=clanker-chain-identity clanker-chain-mqtt';
      envContent = envContent.trimEnd() + (envContent ? "\n" : "") + line + "\n";
      writeFileSync(envPath, envContent, "utf8");
      console.log(`Wrote OPENCLAW_EXTENSIONS to ${envPath}`);
    } else if (!extensionsMatch[1].includes("clanker-chain-identity") || !extensionsMatch[1].includes("clanker-chain-mqtt")) {
      const existingValues = extensionsMatch[1].split(/\s+/).filter(Boolean);
      const mergedValues = [...existingValues];

      for (const extension of ["clanker-chain-identity", "clanker-chain-mqtt"]) {
        if (!mergedValues.includes(extension)) {
          mergedValues.push(extension);
        }
      }

      envContent = envContent.replace(
        /^OPENCLAW_EXTENSIONS=.*$/m,
        `OPENCLAW_EXTENSIONS=${mergedValues.join(" ")}`,
      );
      writeFileSync(envPath, envContent, "utf8");
      console.log(`Updated OPENCLAW_EXTENSIONS in ${envPath}`);
    } else {
      console.log(`OPENCLAW_EXTENSIONS already configured in ${envPath}`);
    }

    // Ensure a basic ~/.openclaw/openclaw.json exists with plugins array.
    const home = os.homedir();
    const openclawDir = join(home, ".openclaw");
    const cfgPath = join(openclawDir, "openclaw.json");
    if (!existsSync(openclawDir)) {
      mkdirSync(openclawDir, { recursive: true });
    }

    if (!existsSync(cfgPath)) {
      const cfg = {
        plugins: {
          enabled: ["clanker-chain-identity", "clanker-chain-mqtt"],
        },
      };
      writeFileSync(cfgPath, JSON.stringify(cfg, null, 2), "utf8");
      console.log(`Created ${cfgPath} with clanker-chain-identity and clanker-chain-mqtt enabled.`);
    } else {
      console.log(`${cfgPath} already exists. Please ensure clanker-chain-identity and clanker-chain-mqtt are enabled there.`);
    }

    console.log("init-openclaw complete. Rebuild your OpenClaw images and restart the stack.");
    process.exit(0);
  }

  console.error(`Unknown command: ${cmd}`);
  usage();
  process.exit(1);
}

main().catch((err) => {
  console.error(err?.message ?? String(err));
  process.exit(1);
});


#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import os from "node:os";
import process from "node:process";

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
  clanker mint <bot_id> [operator_id]
  clanker check mqtt <bot_id> <operator_id>
  clanker check identity [operator_id]

Commands:
  init-openclaw           Wire identity-client-plugin and mqtt-client-plugin into the current OpenClaw repo (.env + basic config).
  mint                    Wraps identity-service/scripts/quick-mint.sh to mint an operator and bot.
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

  if (cmd === "mint") {
    const [botId, operatorId] = rest;
    if (!botId) {
      console.error("mint requires <bot_id> [operator_id]");
      process.exit(1);
    }
    const scriptPath = join(repoRoot, "identity-service", "scripts", "quick-mint.sh");
    if (!existsSync(scriptPath)) {
      console.error(`quick-mint.sh not found at ${scriptPath}`);
      process.exit(1);
    }
    runScript(scriptPath, [botId, operatorId].filter(Boolean));
    return;
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

    if (!envContent.includes("OPENCLAW_EXTENSIONS")) {
      const line = 'OPENCLAW_EXTENSIONS=identity-client-plugin mqtt-client-plugin';
      envContent = envContent.trimEnd() + (envContent ? "\n" : "") + line + "\n";
      writeFileSync(envPath, envContent, "utf8");
      console.log(`Wrote OPENCLAW_EXTENSIONS to ${envPath}`);
    } else if (!envContent.includes("identity-client-plugin") || !envContent.includes("mqtt-client-plugin")) {
      // Naive append for now.
      envContent = envContent.replace(
        /^OPENCLAW_EXTENSIONS=.*$/m,
        "OPENCLAW_EXTENSIONS=identity-client-plugin mqtt-client-plugin",
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
          enabled: ["identity-client-plugin", "mqtt-client-plugin"],
        },
      };
      writeFileSync(cfgPath, JSON.stringify(cfg, null, 2), "utf8");
      console.log(`Created ${cfgPath} with identity-client-plugin and mqtt-client-plugin enabled.`);
    } else {
      console.log(`${cfgPath} already exists. Please ensure identity-client-plugin and mqtt-client-plugin are enabled there.`);
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


/**
 * `clanker doctor` — local readiness checks (mise-doctor habit).
 */

import { getAddress } from "viem";
import {
  ANVIL_DEFAULT_ADDRESS,
  isLocalRpc,
  loadConfig,
  loadOperator,
  clankerHome,
} from "./profile.mjs";
import { detectSetupHints, formatSetupDetectTable } from "./setup-detect.mjs";
import { c, nextHint } from "./ui.mjs";

/**
 * @param {{ home?: string, env?: NodeJS.ProcessEnv, openclawDir?: string, castBin?: string, spawn?: Function }} [opts]
 */
export function runDoctorChecks(opts = {}) {
  const env = opts.env ?? process.env;
  const home = opts.home ?? clankerHome(env);
  const hints = detectSetupHints({
    home,
    env,
    openclawDir: opts.openclawDir,
    castBin: opts.castBin,
    spawn: opts.spawn,
  });
  const config = hints.config ?? loadConfig(home);
  const operator = hints.operator ?? loadOperator(home);

  /** @type {{ id: string, ok: boolean, level: 'pass'|'warn'|'fail', message: string }[]} */
  const checks = [];

  checks.push({
    id: "config",
    ok: Boolean(config),
    level: config ? "pass" : "fail",
    message: config
      ? `config.json present (preset=${config.preset})`
      : "config.json missing — run clanker setup",
  });

  const registry = config?.registryAddress;
  const rpc = config?.chainRpcUrl ?? "";
  checks.push({
    id: "registry",
    ok: Boolean(registry && /^0x[0-9a-fA-F]{40}$/.test(registry)),
    level: registry && /^0x[0-9a-fA-F]{40}$/.test(registry) ? "pass" : "fail",
    message:
      registry && /^0x[0-9a-fA-F]{40}$/.test(registry)
        ? `registry ${registry}`
        : "registry missing — run clanker setup --preset sepolia (or set after local deploy)",
  });

  const hasOwner =
    Boolean(operator?.owner) && /^0x[0-9a-fA-F]{40}$/.test(operator.owner);
  const hasLabel = Boolean(operator?.label);
  checks.push({
    id: "operator",
    ok: hasOwner && hasLabel,
    level: hasOwner && hasLabel ? "pass" : "fail",
    message:
      hasOwner && hasLabel
        ? `operator.json ${operator.label} · ${operator.owner}`
        : "operator.json incomplete — run clanker setup",
  });

  if (hasOwner && rpc && !isLocalRpc(rpc)) {
    const anvil =
      getAddress(operator.owner).toLowerCase() ===
      ANVIL_DEFAULT_ADDRESS.toLowerCase();
    checks.push({
      id: "anvil_public",
      ok: !anvil,
      level: anvil ? "fail" : "pass",
      message: anvil
        ? "owner is Anvil #0 on a public RPC — refuse for mutate; fix owner address"
        : "owner is not Anvil #0",
    });
  }

  const hasKey =
    Boolean(operator?.key?.type === "keyFile" && operator.key.value) ||
    Boolean(operator?.key?.type === "env" && operator.key.value) ||
    Boolean(env.OPERATOR_PRIVATE_KEY);
  checks.push({
    id: "signing",
    ok: true,
    level: hasKey ? "pass" : "warn",
    message: hasKey
      ? "signing key pointer available (mint/revoke OK)"
      : "read-only profile — whoami/bots OK; mint needs --key-file or OPERATOR_PRIVATE_KEY",
  });

  checks.push({
    id: "foundry",
    ok: true,
    level: hints.foundryAvailable ? "pass" : "warn",
    message: hints.foundryAvailable
      ? `Foundry cast OK (${hints.foundryAccounts.length} account(s))`
      : "Foundry cast not on PATH (optional)",
  });

  const readyWhoami = checks
    .filter((ch) => ch.id === "config" || ch.id === "registry" || ch.id === "operator")
    .every((ch) => ch.ok);
  const readyMint = readyWhoami && hasKey &&
    !checks.some((ch) => ch.id === "anvil_public" && !ch.ok);

  return {
    home,
    hints,
    checks,
    readyWhoami,
    readyMint,
    ok: readyWhoami,
  };
}

/**
 * @param {string[]} argv
 * @param {{ home?: string, env?: NodeJS.ProcessEnv }} [opts]
 * @returns {Promise<{ exitCode: number, report: object }>}
 */
export async function runDoctor(argv = [], opts = {}) {
  const json = argv.includes("--json");
  const report = runDoctorChecks(opts);

  if (json) {
    console.log(
      JSON.stringify(
        {
          ok: report.ok,
          readyWhoami: report.readyWhoami,
          readyMint: report.readyMint,
          home: report.home,
          checks: report.checks,
        },
        null,
        2,
      ),
    );
    return { exitCode: report.ok ? 0 : 1, report };
  }

  console.log(c.bold("clanker doctor"));
  console.log("");
  console.log(formatSetupDetectTable(report.hints));
  console.log("");
  console.log(c.bold("Checks"));
  for (const ch of report.checks) {
    const mark =
      ch.level === "pass"
        ? c.green("pass")
        : ch.level === "warn"
          ? c.yellow("warn")
          : c.red("fail");
    console.log(`  [${mark}] ${ch.message}`);
  }
  console.log("");
  if (report.readyWhoami) {
    console.log(c.green("Ready for: clanker whoami"));
  } else {
    console.log(c.red("Not ready for whoami"));
  }
  if (report.readyMint) {
    console.log(c.green("Ready for: clanker operator mint / bot mint"));
  } else {
    console.log(c.dim("Mint/revoke: need signing key (and non-Anvil owner on public RPC)"));
  }

  if (!report.readyWhoami) {
    nextHint(["clanker setup"]);
  } else if (!report.readyMint) {
    nextHint([
      "clanker whoami",
      "clanker setup --key-file ~/.clanker/op.key --force   # to enable mint",
    ]);
  } else {
    nextHint(["clanker whoami", "clanker bots"]);
  }

  return { exitCode: report.ok ? 0 : 1, report };
}

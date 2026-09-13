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
import { publicClientFromRpc } from "./identity-query.mjs";
import { loadPrivySession } from "./privy-session.mjs";
import {
  assessMintBudget,
  budgetToJson,
  formatBudgetSummary,
} from "./mint-budget.mjs";
import { c, nextHint } from "./ui.mjs";

/**
 * @param {{
 *   home?: string,
 *   env?: NodeJS.ProcessEnv,
 *   openclawDir?: string,
 *   castBin?: string,
 *   spawn?: Function,
 *   fetchImpl?: typeof fetch,
 *   publicClient?: { readContract: Function, getBalance: Function },
 *   skipBalance?: boolean,
 * }} [opts]
 */
export async function runDoctorChecks(opts = {}) {
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
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;

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

  const privySession = loadPrivySession(home);
  const hasPrivy =
    Boolean(operator?.key?.type === "privy" && operator.key.value) ||
    Boolean(privySession?.accessToken && privySession?.walletId);
  const hasKey =
    Boolean(operator?.key?.type === "keyFile" && operator.key.value) ||
    Boolean(operator?.key?.type === "env" && operator.key.value) ||
    Boolean(env.OPERATOR_PRIVATE_KEY) ||
    hasPrivy;
  checks.push({
    id: "signing",
    ok: true,
    level: hasKey ? "pass" : "warn",
    message: hasPrivy
      ? "Privy session available (mint/pair/rotate via email vault)"
      : hasKey
        ? "signing key pointer available (mint/pair/rotate OK)"
        : "read-only profile — whoami/bots/fund OK; mint/pair/rotate need clanker login or a key pointer",
  });

  checks.push({
    id: "foundry",
    ok: true,
    level: hints.foundryAvailable ? "pass" : "warn",
    message: hints.foundryAvailable
      ? `Foundry cast OK (${hints.foundryAccounts.length} account(s))`
      : "Foundry cast not on PATH (optional)",
  });

  /** @type {object|null} */
  let budget = null;

  const canCheckBalance =
    !opts.skipBalance &&
    hasOwner &&
    registry &&
    /^0x[0-9a-fA-F]{40}$/.test(registry) &&
    rpc;

  if (canCheckBalance) {
    try {
      if (isLocalRpc(rpc)) {
        budget = await assessMintBudget({
          pub: { readContract: async () => 0n, getBalance: async () => 0n },
          registry,
          owner: getAddress(operator.owner),
          rpc,
          operatorLabel: operator.label,
        });
        checks.push({
          id: "balance",
          ok: true,
          level: "pass",
          message: formatBudgetSummary(budget),
        });
      } else {
        const pub =
          opts.publicClient ?? (await publicClientFromRpc(rpc));
        budget = await assessMintBudget({
          pub,
          registry,
          owner: getAddress(operator.owner),
          rpc,
          operatorLabel: operator.label,
        });
        checks.push({
          id: "balance",
          ok: budget.funded,
          level: budget.funded ? "pass" : "fail",
          message: formatBudgetSummary(budget),
        });
      }
    } catch (err) {
      checks.push({
        id: "balance",
        ok: false,
        level: "warn",
        message: `balance check skipped: ${err.message ?? err}`,
      });
    }
  }

  const authUrl = config?.mqttAuthServiceUrl;
  if (authUrl && typeof fetchImpl === "function") {
    const healthUrl = `${String(authUrl).replace(/\/$/, "")}/health`;
    try {
      const ac = new AbortController();
      const t = setTimeout(() => ac.abort(), 5000);
      const res = await fetchImpl(healthUrl, { signal: ac.signal });
      clearTimeout(t);
      if (res.ok) {
        checks.push({
          id: "mqtt_auth_health",
          ok: true,
          level: "pass",
          message: `mqtt-auth health OK (${healthUrl})`,
        });
      } else {
        checks.push({
          id: "mqtt_auth_health",
          ok: false,
          level: "fail",
          message: `mqtt-auth health HTTP ${res.status} (${healthUrl})`,
        });
      }
    } catch (err) {
      checks.push({
        id: "mqtt_auth_health",
        ok: false,
        level: "warn",
        message: `mqtt-auth health unreachable: ${err.message ?? err}`,
      });
    }
  } else if (config) {
    checks.push({
      id: "mqtt_auth_health",
      ok: true,
      level: "warn",
      message: "mqttAuthServiceUrl not set — skip hub health",
    });
  }

  const readyWhoami = checks
    .filter((ch) => ch.id === "config" || ch.id === "registry" || ch.id === "operator")
    .every((ch) => ch.ok);
  const balanceOk = !checks.some((ch) => ch.id === "balance" && ch.level === "fail");
  const readyMint =
    readyWhoami &&
    hasKey &&
    !checks.some((ch) => ch.id === "anvil_public" && !ch.ok) &&
    balanceOk;

  return {
    home,
    hints,
    checks,
    readyWhoami,
    readyMint,
    ok: readyWhoami,
    budget,
  };
}

/**
 * @param {string[]} argv
 * @param {{ home?: string, env?: NodeJS.ProcessEnv, publicClient?: object, skipBalance?: boolean }} [opts]
 * @returns {Promise<{ exitCode: number, report: object }>}
 */
export async function runDoctor(argv = [], opts = {}) {
  const json = argv.includes("--json");
  const report = await runDoctorChecks(opts);
  const budgetJson = report.budget ? budgetToJson(report.budget) : null;

  if (json) {
    console.log(
      JSON.stringify(
        {
          ok: report.ok,
          readyWhoami: report.readyWhoami,
          readyMint: report.readyMint,
          home: report.home,
          checks: report.checks,
          ...(budgetJson
            ? {
                balanceWei: budgetJson.balanceWei,
                neededWei: budgetJson.neededWei,
                shortfallWei: budgetJson.shortfallWei,
                claimsNeeded: budgetJson.claimsNeeded,
                budget: budgetJson,
              }
            : {}),
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
  } else if (report.budget && !report.budget.funded && !report.budget.local) {
    console.log(c.dim("Mint: fund the operator address first (clanker fund)"));
  } else {
    console.log(
      c.dim(
        "Mint/pair/rotate: need clanker login or a signing key (non-Anvil owner on public RPC)",
      ),
    );
  }

  if (!report.readyWhoami) {
    nextHint(["clanker setup", "clanker login"]);
  } else if (report.budget && !report.budget.funded && !report.budget.local) {
    nextHint(["clanker fund", "clanker doctor"]);
  } else if (!report.readyMint) {
    nextHint([
      "clanker login",
      "clanker whoami",
      "mint/pair/rotate need login or --key-file",
    ]);
  } else {
    nextHint(["clanker whoami", "clanker bots"]);
  }

  return { exitCode: report.ok ? 0 : 1, report };
}

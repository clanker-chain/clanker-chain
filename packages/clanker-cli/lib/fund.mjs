/**
 * `clanker fund` — print mint ETH budget, open faucet, poll until funded.
 */

import { spawn } from "node:child_process";
import { getAddress } from "viem";
import { clankerHome, loadConfig, loadOperator, isLocalRpc } from "./profile.mjs";
import { publicClientFromRpc } from "./identity-query.mjs";
import {
  assessMintBudget,
  budgetToJson,
  formatBudgetSummary,
  formatEthTrim,
} from "./mint-budget.mjs";
import { c, nextHint } from "./ui.mjs";

export const DEFAULT_FUND_TIMEOUT_MS = 5 * 60 * 1000;
export const DEFAULT_FUND_POLL_MS = 5000;

/**
 * Best-effort open URL in the default browser. Never throws.
 * @param {string} url
 * @param {{ platform?: string, spawnImpl?: typeof spawn }} [opts]
 * @returns {Promise<boolean>}
 */
export async function openUrl(url, opts = {}) {
  const platform = opts.platform ?? process.platform;
  const spawnImpl = opts.spawnImpl ?? spawn;
  try {
    if (platform === "darwin") {
      spawnImpl("open", [url], { stdio: "ignore", detached: true }).unref();
      return true;
    }
    if (platform === "win32") {
      spawnImpl("cmd", ["/c", "start", "", url], {
        stdio: "ignore",
        detached: true,
      }).unref();
      return true;
    }
    spawnImpl("xdg-open", [url], { stdio: "ignore", detached: true }).unref();
    return true;
  } catch {
    return false;
  }
}

/**
 * @param {string[]} argv
 */
export function parseFundFlags(argv) {
  let timeoutMs = DEFAULT_FUND_TIMEOUT_MS;
  let pollMs = DEFAULT_FUND_POLL_MS;
  let noOpen = false;
  let json = false;
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--no-open") noOpen = true;
    else if (a === "--json") json = true;
    else if (a === "--timeout" && argv[i + 1]) {
      timeoutMs = Number(argv[++i]);
    } else if (a === "--poll" && argv[i + 1]) {
      pollMs = Number(argv[++i]);
    }
  }
  if (!Number.isFinite(timeoutMs) || timeoutMs < 0) {
    throw new Error("--timeout must be a non-negative number (ms)");
  }
  if (!Number.isFinite(pollMs) || pollMs < 100) {
    throw new Error("--poll must be >= 100 (ms)");
  }
  return { timeoutMs, pollMs, noOpen, json };
}

/**
 * @param {string[]} argv
 * @param {{
 *   home?: string,
 *   env?: NodeJS.ProcessEnv,
 *   publicClient?: { readContract: Function, getBalance: Function },
 *   openUrlImpl?: typeof openUrl,
 *   sleep?: (ms: number) => Promise<void>,
 *   now?: () => number,
 * }} [opts]
 */
export async function runFund(argv = [], opts = {}) {
  const flags = parseFundFlags(argv);
  const env = opts.env ?? process.env;
  const home = opts.home ?? clankerHome(env);
  const config = loadConfig(home);
  const operator = loadOperator(home);
  const sleep =
    opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const now = opts.now ?? (() => Date.now());
  const openUrlImpl = opts.openUrlImpl ?? openUrl;

  if (!config) {
    throw new Error("config.json missing — run clanker setup");
  }
  if (!operator?.owner || !/^0x[0-9a-fA-F]{40}$/.test(operator.owner)) {
    throw new Error("operator.json incomplete — run clanker setup");
  }

  const rpc = config.chainRpcUrl ?? "";
  const registry = config.registryAddress;
  const owner = getAddress(operator.owner);

  if (isLocalRpc(rpc)) {
    const payload = {
      ok: true,
      funded: true,
      local: true,
      owner,
      message: "Anvil is prefunded — no faucet needed",
    };
    if (flags.json) {
      console.log(JSON.stringify(payload, null, 2));
    } else {
      console.log(c.bold("clanker fund"));
      console.log("");
      console.log(c.green("Anvil is prefunded — no faucet needed."));
      nextHint(["clanker doctor", "clanker whoami"]);
    }
    return { exitCode: 0, ...payload };
  }

  if (!registry || !/^0x[0-9a-fA-F]{40}$/.test(registry)) {
    throw new Error(
      "registry missing — run clanker setup --preset sepolia (or set after local deploy)",
    );
  }

  const pub = opts.publicClient ?? (await publicClientFromRpc(rpc));

  const assess = () =>
    assessMintBudget({
      pub,
      registry,
      owner,
      rpc,
      operatorLabel: operator.label,
    });

  let budget = await assess();

  if (flags.json && budget.funded) {
    console.log(
      JSON.stringify({ ok: true, ...budgetToJson(budget) }, null, 2),
    );
    return { exitCode: 0, funded: true, budget };
  }

  if (!flags.json) {
    console.log(c.bold("clanker fund"));
    console.log("");
    console.log(`owner:    ${owner}`);
    console.log(`label:    ${operator.label ?? "(none)"}`);
    console.log(`registry: ${registry}`);
    console.log(`budget:   ${formatBudgetSummary(budget)}`);
    console.log(`faucet:   ${budget.faucetUrl}`);
    console.log(`backup:   ${budget.backupFaucetUrl}`);
    console.log("");
  }

  if (budget.funded) {
    if (!flags.json) {
      console.log(c.green("Already funded for remaining mint fees + gas."));
      nextHint([
        "clanker doctor",
        `clanker operator mint ${operator.label ?? "<label>"} --yes`,
        "clanker bot mint <bot_label> --yes",
      ]);
    }
    return { exitCode: 0, funded: true, budget };
  }

  if (!flags.noOpen) {
    const opened = await openUrlImpl(budget.faucetUrl);
    if (!flags.json) {
      if (opened) {
        console.log(c.dim(`Opened faucet in browser (paste ${owner}).`));
      } else {
        console.log(
          c.dim(`Could not open browser — visit ${budget.faucetUrl}`),
        );
      }
      console.log(
        c.dim(
          `Select Base Sepolia → ETH. CDP ~${budget.dripEth} ETH/claim; claim ~${budget.claimsNeeded} time(s).`,
        ),
      );
      console.log(c.dim("Waiting for balance…"));
      console.log("");
    }
  } else if (!flags.json) {
    console.log(c.dim(`Open faucet: ${budget.faucetUrl}`));
    console.log(c.dim(`Paste address: ${owner}`));
    console.log(c.dim("Waiting for balance…"));
    console.log("");
  }

  const deadline = now() + flags.timeoutMs;
  while (now() < deadline) {
    await sleep(flags.pollMs);
    budget = await assess();
    if (!flags.json) {
      console.log(
        c.dim(
          `have ${formatEthTrim(budget.balanceWei)} / need ${formatEthTrim(budget.neededWei)} ETH`,
        ),
      );
    }
    if (budget.funded) {
      if (flags.json) {
        console.log(
          JSON.stringify({ ok: true, ...budgetToJson(budget) }, null, 2),
        );
      } else {
        console.log("");
        console.log(c.green("Funded. Ready to mint."));
        nextHint([
          "clanker doctor",
          `clanker operator mint ${operator.label ?? "<label>"} --yes`,
          "clanker bot mint <bot_label> --yes",
        ]);
      }
      return { exitCode: 0, funded: true, budget };
    }
  }

  if (flags.json) {
    console.log(
      JSON.stringify(
        { ok: false, funded: false, timedOut: true, ...budgetToJson(budget) },
        null,
        2,
      ),
    );
  } else {
    console.log("");
    console.log(c.red("Timed out waiting for funds."));
    console.log(formatBudgetSummary(budget));
    nextHint([
      `Open ${budget.faucetUrl} and claim again`,
      `Backup: ${budget.backupFaucetUrl}`,
      "clanker fund",
    ]);
  }
  return { exitCode: 1, funded: false, budget, timedOut: true };
}

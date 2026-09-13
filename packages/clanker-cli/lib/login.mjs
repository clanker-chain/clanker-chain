/**
 * `clanker login` / `clanker logout` — Privy device grant for the operator vault.
 */

import { getAddress } from "viem";
import { openUrl } from "./fund.mjs";
import {
  loadOperator,
  writeOperator,
  clankerHome,
  loadConfig,
} from "./profile.mjs";
import {
  authenticateWallets,
  pollDeviceToken,
  requestDeviceAuthorization,
} from "./privy-client.mjs";
import {
  clearPrivySession,
  loadPrivySession,
  savePrivySession,
} from "./privy-session.mjs";
import { resolvePrivyAppId } from "./privy-constants.mjs";
import { c, nextHint } from "./ui.mjs";

/**
 * @param {string[]} argv
 */
export function parseLoginFlags(argv) {
  let noOpen = false;
  let json = false;
  let operator = null;
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--no-open") noOpen = true;
    else if (a === "--json") json = true;
    else if (a === "--operator" && argv[i + 1]) operator = argv[++i];
  }
  return { noOpen, json, operator };
}

/**
 * @param {string[]} argv
 * @param {{
 *   home?: string,
 *   env?: NodeJS.ProcessEnv,
 *   fetchImpl?: typeof fetch,
 *   openUrlImpl?: typeof openUrl,
 *   sleep?: (ms: number) => Promise<void>,
 *   now?: () => number,
 * }} [opts]
 */
export async function runLogin(argv = [], opts = {}) {
  const flags = parseLoginFlags(argv);
  const env = opts.env ?? process.env;
  const home = opts.home ?? clankerHome(env);
  const openUrlImpl = opts.openUrlImpl ?? openUrl;

  const device = await requestDeviceAuthorization({
    appId: resolvePrivyAppId(env),
    fetchImpl: opts.fetchImpl,
  });

  const url =
    device.verificationUriComplete ||
    `${device.verificationUri}?user_code=${encodeURIComponent(device.userCode)}`;

  if (!flags.json) {
    console.log(c.bold("clanker login"));
    console.log("");
    console.log("Approve CLI access to your operator wallet (email vault).");
    console.log("");
    console.log(`Visit:  ${url}`);
    console.log(`Code:   ${device.userCode}`);
    console.log("");
    console.log(c.dim("Waiting for browser approval…"));
  }

  if (!flags.noOpen) {
    await openUrlImpl(url);
  }

  const tokens = await pollDeviceToken({
    appId: device.appId,
    deviceCode: device.deviceCode,
    interval: device.interval,
    expiresIn: device.expiresIn,
    fetchImpl: opts.fetchImpl,
    sleep: opts.sleep,
    now: opts.now,
  });

  const auth = await authenticateWallets({
    appId: device.appId,
    accessToken: tokens.accessToken,
    fetchImpl: opts.fetchImpl,
  });

  const session = {
    appId: device.appId,
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    expiresAt: Date.now() + tokens.expiresIn * 1000,
    walletId: auth.walletId,
    address: auth.address,
    createdAt: Date.now(),
  };
  const stored = savePrivySession(session, home);

  const existing = loadOperator(home);
  const label = flags.operator || existing?.label || null;
  if (existing?.owner && getAddress(existing.owner) !== auth.address) {
    throw new Error(
      `Logged-in address ${auth.address} does not match operator.json owner ${existing.owner}. ` +
        `Use a matching login, or clanker setup --force with the new owner.`,
    );
  }

  if (label || existing) {
    writeOperator(
      {
        label: label || existing.label,
        owner: auth.address,
        key: { type: "privy", value: auth.walletId },
      },
      home,
    );
  } else if (!loadConfig(home)) {
    // Login alone is enough for session; setup still needed for network + label.
  } else {
    // Config exists but no operator yet — leave operator.json to setup / mint.
  }

  const payload = {
    ok: true,
    address: auth.address,
    walletId: auth.walletId,
    storage: stored.storage,
    label: label || existing?.label || null,
  };

  if (flags.json) {
    console.log(JSON.stringify(payload, null, 2));
  } else {
    console.log("");
    console.log(c.green(`Logged in as ${auth.address}`));
    console.log(c.dim(`wallet:  ${auth.walletId}`));
    console.log(c.dim(`session: ${stored.storage}`));
    if (!label && !existing?.label) {
      nextHint([
        "clanker setup --preset sepolia --operator org.you --yes   # if no profile yet",
        "clanker fund",
        "clanker whoami",
        "clanker pair add <peer> --yes",
      ]);
    } else {
      nextHint([
        "clanker fund",
        "clanker whoami",
        "clanker pair add <peer> --yes",
        "clanker operator mint <label> --yes   # if not minted yet",
      ]);
    }
  }
  return { exitCode: 0, ...payload, session };
}

/**
 * @param {string[]} argv
 * @param {{ home?: string, env?: NodeJS.ProcessEnv }} [opts]
 */
export async function runLogout(argv = [], opts = {}) {
  const json = argv.includes("--json");
  const home = opts.home ?? clankerHome(opts.env ?? process.env);
  const had = Boolean(loadPrivySession(home));
  clearPrivySession(home);
  const operator = loadOperator(home);
  if (operator?.key?.type === "privy") {
    writeOperator(
      {
        label: operator.label,
        owner: operator.owner,
        key: null,
      },
      home,
    );
  }
  if (json) {
    console.log(JSON.stringify({ ok: true, cleared: had }, null, 2));
  } else {
    console.log(c.bold("clanker logout"));
    console.log(had ? c.green("Cleared Privy CLI session.") : c.dim("No session stored."));
    console.log(
      c.dim(
        "Revoke grants anytime in the Privy dashboard / account settings if needed.",
      ),
    );
  }
  return { exitCode: 0, cleared: had };
}

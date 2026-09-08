/**
 * Interactive / flag-driven `clanker setup`.
 */

import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { existsSync } from "node:fs";
import { getAddress } from "viem";
import {
  ANVIL_DEFAULT_ADDRESS,
  PRESETS,
  clankerHome,
  configPath,
  initProfile,
  isLocalRpc,
  operatorPath,
  writeOperator,
} from "./profile.mjs";
import {
  publicClientFromRpc,
  readOperator,
  resolvePreferredOperator,
} from "./identity-query.mjs";
import {
  SEPOLIA_FAST_FROM_BLOCK,
  addressFromEnv,
  addressFromKeyFile,
  detectSetupHints,
} from "./setup-detect.mjs";

/**
 * @param {string[]} argv
 */
export function parseSetupFlags(argv) {
  let preset = null;
  let operator = null;
  let address = null;
  let keyFile = null;
  let keyEnv = null;
  let fromBlock = null;
  let force = false;
  let yes = false;
  let skipKey = false;
  let skipChainCheck = false;

  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--preset" && argv[i + 1]) preset = argv[++i];
    else if (a === "--operator" && argv[i + 1]) operator = argv[++i];
    else if (a === "--address" && argv[i + 1]) address = argv[++i];
    else if (a === "--key-file" && argv[i + 1]) keyFile = argv[++i];
    else if (a === "--key-env" && argv[i + 1]) keyEnv = argv[++i];
    else if (a === "--from-block" && argv[i + 1]) fromBlock = BigInt(argv[++i]);
    else if (a === "--force") force = true;
    else if (a === "--yes" || a === "-y") yes = true;
    else if (a === "--skip-key") skipKey = true;
    else if (a === "--skip-chain-check") skipChainCheck = true;
  }

  return {
    preset,
    operator,
    address,
    keyFile,
    keyEnv,
    fromBlock,
    force,
    yes,
    skipKey,
    skipChainCheck,
  };
}

/**
 * Validate address + label against registry (and Anvil-on-public).
 * @param {{ rpc: string, registry: string, label: string, address: string, skipChainCheck?: boolean }} opts
 */
export async function assertSetupIdentity(opts) {
  const address = getAddress(opts.address);
  const local = isLocalRpc(opts.rpc);

  if (!local && address.toLowerCase() === ANVIL_DEFAULT_ADDRESS.toLowerCase()) {
    throw new Error(
      "Refusing Anvil account #0 address on a non-local RPC. Use your real operator owner address.",
    );
  }

  if (opts.skipChainCheck) {
    return { address, operator: null, skipped: true };
  }

  if (!opts.registry || !/^0x[0-9a-fA-F]{40}$/.test(opts.registry)) {
    if (local) {
      return { address, operator: null, skipped: true };
    }
    throw new Error("Registry address required for chain check on public RPC.");
  }

  const pub = await publicClientFromRpc(opts.rpc);
  const op = await readOperator(pub, opts.registry, opts.label);

  if (op.registeredAt === 0n) {
    // New operator — fine; mint later
    return { address, operator: op, skipped: false, unregistered: true };
  }

  const resolved = await resolvePreferredOperator(pub, {
    registry: opts.registry,
    label: opts.label,
    owner: address,
  });
  if (resolved.error) {
    throw new Error(resolved.error);
  }
  return { address, operator: resolved.operator, skipped: false, unregistered: false };
}

/**
 * Build key pointer from flags / choices.
 * @returns {{ type: 'env'|'keyFile', value: string }|null}
 */
export function buildKeyPointer({ keyFile, keyEnv, skipKey, env = process.env }) {
  if (skipKey) return null;
  if (keyFile) {
    if (!existsSync(keyFile)) throw new Error(`Key file not found: ${keyFile}`);
    // validate readable
    addressFromKeyFile(keyFile);
    return { type: "keyFile", value: keyFile };
  }
  if (keyEnv) {
    return { type: "env", value: keyEnv };
  }
  if (env.OPERATOR_PRIVATE_KEY) {
    return { type: "env", value: "OPERATOR_PRIVATE_KEY" };
  }
  return null;
}

/**
 * Apply setup choices to disk.
 */
export function applySetup(choices, opts = {}) {
  const home = opts.home ?? clankerHome(opts.env);
  const force = Boolean(choices.force);

  if (existsSync(configPath(home)) && !force) {
    throw new Error(
      `Profile already exists at ${configPath(home)}. Pass --force to overwrite.`,
    );
  }
  if (existsSync(operatorPath(home)) && !force) {
    throw new Error(
      `Operator profile already exists at ${operatorPath(home)}. Pass --force to overwrite.`,
    );
  }

  const { path: configFile, config } = initProfile(choices.preset, {
    force: true,
    home,
    registryAddress: choices.registryAddress,
    fromBlock: choices.fromBlock,
  });

  const { path: opFile, operator } = writeOperator(
    {
      label: choices.label,
      owner: getAddress(choices.address),
      key: choices.key,
    },
    home,
  );

  return { configPath: configFile, config, operatorPath: opFile, operator };
}

/**
 * Non-interactive setup (agents / CI).
 * @param {string[]} argv
 * @param {{ home?: string, env?: NodeJS.ProcessEnv, skipChainCheck?: boolean }} [opts]
 */
export async function runSetupNonInteractive(argv, opts = {}) {
  const flags = parseSetupFlags(argv);
  const env = opts.env ?? process.env;
  const home = opts.home ?? clankerHome(env);

  if (!flags.preset || !PRESETS[flags.preset]) {
    throw new Error(
      "Non-interactive setup requires --preset sepolia|local (stdin is not a TTY). " +
        "Also pass --operator <label> and --address 0x…",
    );
  }
  if (!flags.operator) {
    throw new Error("Non-interactive setup requires --operator <label>");
  }
  if (!flags.address && !flags.keyFile && !env.OPERATOR_PRIVATE_KEY) {
    throw new Error(
      "Non-interactive setup requires --address 0x…, --key-file, or OPERATOR_PRIVATE_KEY",
    );
  }

  let address = flags.address;
  if (!address && flags.keyFile) address = addressFromKeyFile(flags.keyFile);
  if (!address && env.OPERATOR_PRIVATE_KEY) address = addressFromEnv(env);

  const preset = PRESETS[flags.preset];
  let fromBlock = flags.fromBlock;
  if (fromBlock == null && flags.preset === "sepolia") {
    fromBlock = SEPOLIA_FAST_FROM_BLOCK;
  }

  const rpc = preset.chainRpcUrl;
  const registry = preset.registryAddress;

  await assertSetupIdentity({
    rpc,
    registry,
    label: flags.operator,
    address,
    skipChainCheck: flags.skipChainCheck || opts.skipChainCheck || !registry,
  });

  const key = buildKeyPointer({
    keyFile: flags.keyFile,
    keyEnv: flags.keyEnv,
    skipKey: flags.skipKey,
    env,
  });

  // Address from key must match --address when both set
  if (flags.keyFile && flags.address) {
    const fromKey = getAddress(addressFromKeyFile(flags.keyFile));
    if (fromKey !== getAddress(flags.address)) {
      throw new Error(
        `Key file address ${fromKey} does not match --address ${getAddress(flags.address)}`,
      );
    }
  }

  return applySetup(
    {
      preset: flags.preset,
      force: flags.force || flags.yes,
      fromBlock,
      registryAddress: registry,
      label: flags.operator,
      address,
      key,
    },
    { home, env },
  );
}

/**
 * Interactive wizard when stdin is a TTY.
 */
export async function runSetupInteractive(argv, opts = {}) {
  const flags = parseSetupFlags(argv);
  const env = opts.env ?? process.env;
  const home = opts.home ?? clankerHome(env);
  const hints = detectSetupHints({
    home,
    env,
    castBin: opts.castBin,
    spawn: opts.spawn,
    openclawDir: opts.openclawDir,
  });

  const rl =
    opts.rl ??
    createInterface({ input, output });
  const ask = async (q, def) => {
    const suffix = def != null && def !== "" ? ` [${def}]` : "";
    const ans = (await rl.question(`${q}${suffix}: `)).trim();
    return ans || def || "";
  };
  const askYesNo = async (q, defaultYes = true) => {
    const def = defaultYes ? "Y/n" : "y/N";
    const ans = (await rl.question(`${q} (${def}): `)).trim().toLowerCase();
    if (!ans) return defaultYes;
    return ans === "y" || ans === "yes";
  };

  try {
    console.log("");
    console.log("clanker setup — create your local operator profile");
    console.log("");
    console.log(
      "This writes ~/.clanker/config.json (network) and operator.json (who you are).",
    );
    console.log(
      "Reads like `clanker whoami` can use the owner address without a private key;",
    );
    console.log("mint/revoke still need a key file or OPERATOR_PRIVATE_KEY later.");
    console.log("");
    console.log(`Profile directory: ${home}`);
    console.log("");

    // Detection summary
    console.log("Detected on this machine:");
    if (hints.hasConfig) {
      const p = hints.config?.preset ?? "?";
      const reg = hints.config?.registryAddress ?? "(none)";
      console.log(`  • Network config already at config.json (preset=${p}, registry=${reg})`);
    } else {
      console.log("  • No config.json yet — will create one");
    }
    if (hints.hasOperator) {
      console.log(
        `  • Operator profile already at operator.json (label=${hints.operator?.label}, owner=${hints.operator?.owner})`,
      );
    } else {
      console.log("  • No operator.json yet — that is what we need for bare `whoami`");
    }
    if (hints.foundryAvailable && hints.foundryAccounts.length) {
      console.log(
        `  • Foundry keystore accounts: ${hints.foundryAccounts.join(", ")} (names only; you paste the 0x address)`,
      );
    } else if (!hints.foundryAvailable) {
      console.log("  • Foundry `cast` not on PATH (optional)");
    }
    if (hints.openclawBots.length) {
      console.log(
        `  • OpenClaw bot key files: ${hints.openclawBots.join(", ")}`,
      );
      console.log(
        "    (These are bot signing keys — not your operator wallet. Useful context only.)",
      );
    }
    if (hints.hasOperatorPrivateKeyEnv) {
      console.log(
        `  • OPERATOR_PRIVATE_KEY is set in this shell → ${hints.envAddress ?? "(invalid key)"}`,
      );
    }
    console.log("");

    if ((hints.hasConfig || hints.hasOperator) && !flags.force) {
      if (hints.hasConfig && !hints.hasOperator) {
        console.log(
          "You already have network settings from `clanker init`, but no operator identity.",
        );
        console.log(
          "Continuing will refresh config.json if needed and create operator.json.",
        );
        const cont = await askYesNo("Continue setup?", true);
        if (!cont) {
          throw new Error("Aborted. Re-run `clanker setup` when ready.");
        }
        flags.force = true;
      } else {
        console.log(
          "A full profile already exists. Continuing will REPLACE config.json and/or operator.json",
        );
        console.log("with the answers you give next (same files, new contents).");
        const overwrite = await askYesNo("Replace existing profile files?", false);
        if (!overwrite) {
          throw new Error(
            "Aborted. Pass --force to replace, or edit ~/.clanker/*.json by hand.",
          );
        }
        flags.force = true;
      }
      console.log("");
    }

    console.log("— Network —");
    let preset =
      flags.preset ||
      hints.config?.preset ||
      (await ask("Which network? sepolia (public hub) or local (Anvil)", "sepolia"));
    preset = String(preset).toLowerCase();
    if (!PRESETS[preset]) throw new Error(`Unknown preset "${preset}"`);

    let fromBlock = flags.fromBlock;
    if (preset === "sepolia") {
      const useFast =
        fromBlock != null
          ? false
          : await askYesNo(
              `Speed up chain scans? Use fromBlock ${SEPOLIA_FAST_FROM_BLOCK} (recommended on public RPC)`,
              true,
            );
      if (fromBlock == null) {
        fromBlock = useFast ? SEPOLIA_FAST_FROM_BLOCK : PRESETS.sepolia.fromBlock;
      }
    }

    console.log("");
    console.log("— Operator identity —");
    console.log(
      "We need the wallet address that owns (or will own) your on-chain operator label.",
    );
    let address = flags.address ?? null;
    if (!address && flags.keyFile) {
      address = addressFromKeyFile(flags.keyFile);
      console.log(`Using address from --key-file: ${address}`);
    }
    if (!address && hints.envAddress) {
      const useEnv = await askYesNo(
        `Use address from OPERATOR_PRIVATE_KEY (${hints.envAddress})?`,
        true,
      );
      if (useEnv) address = hints.envAddress;
    }
    if (!address && hints.operator?.owner) {
      const useOp = await askYesNo(
        `Keep existing operator.json owner (${hints.operator.owner})?`,
        true,
      );
      if (useOp) address = hints.operator.owner;
    }
    if (!address && hints.foundryAccounts.length) {
      console.log("");
      console.log("Foundry accounts on this machine (passwords are never stored here):");
      hints.foundryAccounts.forEach((n, i) => console.log(`  ${i + 1}. ${n}`));
      const pick = await ask(
        "Type a Foundry account name to use, or leave blank to paste an address",
        hints.foundryAccounts[0] ?? "",
      );
      if (pick) {
        address = await ask(
          `Paste the 0x address for "${pick}" (cast wallet address ${pick} after unlock)`,
          "",
        );
      }
    }
    if (!address) {
      address = await ask("Operator owner address (0x…)", "");
    }
    if (!address || !/^0x[0-9a-fA-F]{40}$/.test(address)) {
      throw new Error("A valid 0x operator address is required");
    }
    address = getAddress(address);

    let label =
      flags.operator ||
      hints.operator?.label ||
      (await ask("Operator label on-chain (e.g. org.openclaw.pat or org.you)", ""));
    if (!label) throw new Error("Operator label is required");

    const presetCfg = PRESETS[preset];
    console.log("");
    console.log("— Chain check —");
    console.log(`Looking up "${label}" on ${preset}…`);
    const check = await assertSetupIdentity({
      rpc: presetCfg.chainRpcUrl,
      registry: presetCfg.registryAddress,
      label,
      address,
      skipChainCheck: flags.skipChainCheck || !presetCfg.registryAddress,
    });
    if (check.unregistered) {
      console.log(
        `OK: "${label}" is not registered yet — after setup, run: clanker operator mint ${label}`,
      );
    } else if (check.operator) {
      console.log(`OK: "${label}" is active on-chain and owned by this address.`);
    }

    console.log("");
    console.log("— Signing key (optional) —");
    console.log(
      "Only needed for mint/revoke/transfer. Skip for read-only whoami/bots.",
    );
    let keyFile = flags.keyFile;
    let keyEnv = flags.keyEnv;
    let skipKey = flags.skipKey;
    if (!skipKey && !keyFile && !keyEnv) {
      if (hints.hasOperatorPrivateKeyEnv) {
        const use = await askYesNo(
          "Remember OPERATOR_PRIVATE_KEY as the signing pointer in operator.json?",
          true,
        );
        if (use) keyEnv = "OPERATOR_PRIVATE_KEY";
        else skipKey = true;
      } else {
        const path = await ask(
          "Path to operator private-key file (blank = read-only profile)",
          "",
        );
        if (path) keyFile = path;
        else skipKey = true;
      }
    }

    const key = buildKeyPointer({ keyFile, keyEnv, skipKey, env });
    if (key?.type === "keyFile") {
      const fromKey = getAddress(addressFromKeyFile(key.value));
      if (fromKey !== address) {
        throw new Error(`Key file address ${fromKey} does not match chosen owner ${address}`);
      }
    }

    console.log("");
    console.log("— Summary (about to write) —");
    console.log(`  network:  ${preset}`);
    console.log(`  fromBlock:${fromBlock ?? presetCfg.fromBlock}`);
    console.log(`  label:    ${label}`);
    console.log(`  owner:    ${address}`);
    console.log(
      `  signing:  ${key ? `${key.type}=${key.value}` : "none (read-only whoami/bots)"}`,
    );
    const ok = flags.yes || (await askYesNo("Write these files now?", true));
    if (!ok) throw new Error("Aborted");

    const result = applySetup(
      {
        preset,
        force: true,
        fromBlock: fromBlock ?? undefined,
        registryAddress: presetCfg.registryAddress,
        label,
        address,
        key,
      },
      { home, env },
    );

    console.log("");
    console.log(`Wrote ${result.configPath}`);
    console.log(`Wrote ${result.operatorPath}`);
    if (!key) {
      console.log("");
      console.log("Next: clanker whoami");
      console.log(
        "For mint/revoke later: re-run setup with a key file, or pass --key-file / OPERATOR_PRIVATE_KEY.",
      );
    } else {
      console.log("");
      console.log("Next: clanker whoami");
    }
    return result;
  } finally {
    if (!opts.rl) rl.close();
  }
}

/**
 * Entry: interactive if TTY (unless --yes with full flags), else non-interactive.
 */
export async function runSetup(argv, opts = {}) {
  const flags = parseSetupFlags(argv);
  const isTTY = opts.isTTY ?? Boolean(input.isTTY);

  // Fully flagged non-interactive path
  if (
    !isTTY ||
    (flags.yes && flags.preset && flags.operator && (flags.address || flags.keyFile))
  ) {
    if (!isTTY && !(flags.preset && flags.operator)) {
      return runSetupNonInteractive(argv, opts);
    }
    if (flags.yes && flags.preset && flags.operator && (flags.address || flags.keyFile || opts.env?.OPERATOR_PRIVATE_KEY || process.env.OPERATOR_PRIVATE_KEY)) {
      return runSetupNonInteractive(argv, opts);
    }
  }

  if (!isTTY) {
    return runSetupNonInteractive(argv, opts);
  }

  return runSetupInteractive(argv, opts);
}

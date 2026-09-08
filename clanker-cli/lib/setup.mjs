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
    console.log("clanker setup — local profile wizard");
    console.log(`home: ${home}`);
    if (hints.hasConfig) console.log(`existing config: ${hints.configPath}`);
    if (hints.hasOperator) console.log(`existing operator: ${hints.operatorPath}`);
    if (hints.foundryAvailable && hints.foundryAccounts.length) {
      console.log(`Foundry accounts: ${hints.foundryAccounts.join(", ")}`);
    } else if (!hints.foundryAvailable) {
      console.log("Foundry cast: not found (optional)");
    }
    if (hints.openclawBots.length) {
      console.log(
        `OpenClaw bot keys: ${hints.openclawBots.join(", ")} (bot keys ≠ operator owner)`,
      );
    }
    if (hints.hasOperatorPrivateKeyEnv) {
      console.log(`OPERATOR_PRIVATE_KEY: set → ${hints.envAddress ?? "(invalid)"}`);
    }
    console.log("");

    if ((hints.hasConfig || hints.hasOperator) && !flags.force) {
      const overwrite = await askYesNo("Overwrite existing ~/.clanker profile?", false);
      if (!overwrite) {
        throw new Error("Aborted (profile exists). Re-run with --force to overwrite.");
      }
      flags.force = true;
    }

    let preset =
      flags.preset ||
      hints.config?.preset ||
      (await ask("Preset (sepolia|local)", "sepolia"));
    preset = String(preset).toLowerCase();
    if (!PRESETS[preset]) throw new Error(`Unknown preset "${preset}"`);

    let fromBlock = flags.fromBlock;
    if (preset === "sepolia") {
      const useFast =
        fromBlock != null
          ? false
          : await askYesNo(
              `Use faster fromBlock ${SEPOLIA_FAST_FROM_BLOCK} for public RPC scans?`,
              true,
            );
      if (fromBlock == null) {
        fromBlock = useFast ? SEPOLIA_FAST_FROM_BLOCK : PRESETS.sepolia.fromBlock;
      }
    }

    let address = flags.address ?? null;
    if (!address && flags.keyFile) {
      address = addressFromKeyFile(flags.keyFile);
    }
    if (!address && hints.envAddress) {
      const useEnv = await askYesNo(`Use address from OPERATOR_PRIVATE_KEY (${hints.envAddress})?`, true);
      if (useEnv) address = hints.envAddress;
    }
    if (!address && hints.operator?.owner) {
      const useOp = await askYesNo(`Use existing operator.json owner (${hints.operator.owner})?`, true);
      if (useOp) address = hints.operator.owner;
    }
    if (!address && hints.foundryAccounts.length) {
      console.log("Foundry accounts (signing still needs --key-file or OPERATOR_PRIVATE_KEY):");
      hints.foundryAccounts.forEach((n, i) => console.log(`  ${i + 1}. ${n}`));
      const pick = await ask("Foundry account name to associate (or leave blank)", "");
      if (pick) {
        address = await ask(
          `Address for Foundry account "${pick}" (paste 0x…; unlock via cast if needed)`,
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
      (await ask("Operator label (e.g. org.you)", ""));
    if (!label) throw new Error("Operator label is required");

    const presetCfg = PRESETS[preset];
    console.log("Checking chain…");
    const check = await assertSetupIdentity({
      rpc: presetCfg.chainRpcUrl,
      registry: presetCfg.registryAddress,
      label,
      address,
      skipChainCheck: flags.skipChainCheck || !presetCfg.registryAddress,
    });
    if (check.unregistered) {
      console.log(`Note: "${label}" is not registered yet — run clanker operator mint after setup.`);
    } else if (check.operator) {
      console.log(`On-chain: ${label} active, owner matches.`);
    }

    let keyFile = flags.keyFile;
    let keyEnv = flags.keyEnv;
    let skipKey = flags.skipKey;
    if (!skipKey && !keyFile && !keyEnv) {
      if (hints.hasOperatorPrivateKeyEnv) {
        const use = await askYesNo("Store env pointer OPERATOR_PRIVATE_KEY for signing?", true);
        if (use) keyEnv = "OPERATOR_PRIVATE_KEY";
        else skipKey = true;
      } else {
        const path = await ask(
          "Path to operator key file for signing (leave blank for read-only whoami)",
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

    console.log("\nWill write:");
    console.log(`  preset:   ${preset}`);
    console.log(`  fromBlock:${fromBlock ?? presetCfg.fromBlock}`);
    console.log(`  label:    ${label}`);
    console.log(`  owner:    ${address}`);
    console.log(`  key:      ${key ? `${key.type}=${key.value}` : "(none — read-only)"}`);
    const ok = flags.yes || (await askYesNo("Write profile?", true));
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

    console.log(`\nWrote ${result.configPath}`);
    console.log(`Wrote ${result.operatorPath}`);
    if (!key) {
      console.log("Read-only profile: `clanker whoami` works; mint/revoke need --key-file or OPERATOR_PRIVATE_KEY.");
    } else {
      console.log("Try: clanker whoami");
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

/**
 * Interactive / flag-driven `clanker setup`.
 */

import { stdin as input } from "node:process";
import { existsSync } from "node:fs";
import { getAddress } from "viem";
import * as clack from "@clack/prompts";
import {
  ANVIL_DEFAULT_ADDRESS,
  PRESETS,
  SEPOLIA_FAST_FROM_BLOCK,
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
  addressFromEnv,
  addressFromKeyFile,
  detectSetupHints,
  formatSetupDetectTable,
} from "./setup-detect.mjs";
import {
  defaultOperatorKeyPath,
  exportFoundryKey,
  resolveFoundryAddress,
} from "./foundry.mjs";
import {
  consumerFundHints,
  generateOperatorKeyFile,
} from "./operator-key.mjs";
import { c, nextHint } from "./ui.mjs";
import { join } from "node:path";

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
  let foundryAccount = null;
  let exportKey = false;
  let generateKey = false;

  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--preset" && argv[i + 1]) preset = argv[++i];
    else if (a === "--operator" && argv[i + 1]) operator = argv[++i];
    else if (a === "--address" && argv[i + 1]) address = argv[++i];
    else if (a === "--key-file" && argv[i + 1]) keyFile = argv[++i];
    else if (a === "--key-env" && argv[i + 1]) keyEnv = argv[++i];
    else if (a === "--from-block" && argv[i + 1]) fromBlock = BigInt(argv[++i]);
    else if (a === "--foundry-account" && argv[i + 1]) foundryAccount = argv[++i];
    else if (a === "--export-key") exportKey = true;
    else if (a === "--generate-key") generateKey = true;
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
    foundryAccount,
    exportKey,
    generateKey,
  };
}

function cancelIf(value) {
  if (clack.isCancel(value)) {
    clack.cancel("Setup aborted.");
    process.exit(0);
  }
  return value;
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
 * @returns {{ type: 'env'|'keyFile', value: string }|null}
 */
export function buildKeyPointer({ keyFile, keyEnv, skipKey, env = process.env }) {
  if (skipKey) return null;
  if (keyFile) {
    if (!existsSync(keyFile)) throw new Error(`Key file not found: ${keyFile}`);
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
 */
export async function runSetupNonInteractive(argv, opts = {}) {
  const flags = parseSetupFlags(argv);
  const env = opts.env ?? process.env;
  const home = opts.home ?? clankerHome(env);

  if (!flags.preset || !PRESETS[flags.preset]) {
    throw new Error(
      "Non-interactive setup requires --preset sepolia|local (stdin is not a TTY). " +
        "Also pass --operator <label> and --generate-key (or --address / --key-file)",
    );
  }
  if (!flags.operator) {
    throw new Error("Non-interactive setup requires --operator <label>");
  }

  let address = flags.address;
  let keyFile = flags.keyFile;
  const castOpts = {
    castBin: opts.castBin,
    spawn: opts.spawn,
    inheritStdio: false,
  };

  if (flags.generateKey) {
    if (flags.skipKey) {
      throw new Error("Cannot combine --generate-key with --skip-key");
    }
    const dest = keyFile || defaultOperatorKeyPath(home);
    const created = generateOperatorKeyFile(dest, {
      force: flags.force,
    });
    keyFile = created.path;
    if (address && getAddress(address) !== getAddress(created.address)) {
      throw new Error(
        `Generated key address ${created.address} does not match --address ${getAddress(address)}`,
      );
    }
    address = created.address;
  }

  if (flags.foundryAccount) {
    if (!address) {
      address = resolveFoundryAddress(flags.foundryAccount, castOpts);
    }
    if (flags.exportKey && !keyFile && !flags.skipKey) {
      const dest = defaultOperatorKeyPath(home);
      const exported = exportFoundryKey(flags.foundryAccount, dest, castOpts);
      keyFile = exported.path;
      if (getAddress(exported.address) !== getAddress(address)) {
        throw new Error(
          `Exported Foundry key address ${exported.address} does not match ${address}`,
        );
      }
    }
  }

  if (!address && keyFile) address = addressFromKeyFile(keyFile);
  if (!address && env.OPERATOR_PRIVATE_KEY) address = addressFromEnv(env);
  if (!address) {
    throw new Error(
      "Non-interactive setup requires --generate-key, --address 0x…, --key-file, OPERATOR_PRIVATE_KEY, or --foundry-account",
    );
  }

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
    keyFile,
    keyEnv: flags.keyEnv,
    skipKey: flags.skipKey,
    env,
  });

  if (keyFile && flags.address) {
    const fromKey = getAddress(addressFromKeyFile(keyFile));
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
 * Interactive wizard (Clack) when stdin is a TTY.
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

  clack.intro(c.bold("clanker setup"));
  clack.log.step(
    "Sets up your operator identity (org account) and network for OpenClaw bots.",
  );
  clack.log.message(
    c.dim(
      "New here? Create a key file — no wallet app or Foundry required. Mint needs a little test ETH later.",
    ),
  );
  clack.log.message(c.dim(`Profile: ${home}`));
  console.log("");
  console.log(c.dim(formatSetupDetectTable(hints)));
  console.log("");

  if ((hints.hasConfig || hints.hasOperator) && !flags.force) {
    if (hints.hasConfig && !hints.hasOperator) {
      const cont = cancelIf(
        await clack.confirm({
          message: "Network config exists; continue to create operator.json?",
          initialValue: true,
        }),
      );
      if (!cont) {
        clack.cancel("Aborted.");
        process.exit(0);
      }
      flags.force = true;
    } else {
      const overwrite = cancelIf(
        await clack.confirm({
          message: "Replace existing config.json / operator.json?",
          initialValue: false,
        }),
      );
      if (!overwrite) {
        clack.cancel("Aborted. Pass --force to replace.");
        process.exit(0);
      }
      flags.force = true;
    }
  }

  let preset = flags.preset || hints.config?.preset || null;
  if (!preset) {
    preset = cancelIf(
      await clack.select({
        message: "Network",
        options: [
          { value: "sepolia", label: "sepolia", hint: "public closed-beta hub" },
          { value: "local", label: "local", hint: "Anvil" },
        ],
        initialValue: "sepolia",
      }),
    );
  }
  preset = String(preset).toLowerCase();
  if (!PRESETS[preset]) throw new Error(`Unknown preset "${preset}"`);

  // Fast Sepolia default — no interactive fromBlock question
  let fromBlock = flags.fromBlock;
  if (fromBlock == null && preset === "sepolia") {
    fromBlock = SEPOLIA_FAST_FROM_BLOCK;
  }

  let address = flags.address ?? null;
  let foundryAccountUsed = null;
  let generatedKeyFile = null;
  if (!address && flags.generateKey) {
    const dest = flags.keyFile || defaultOperatorKeyPath(home);
    let forceGen = flags.force;
    if (existsSync(dest) && !forceGen) {
      forceGen = cancelIf(
        await clack.confirm({
          message: `Overwrite existing ${dest}?`,
          initialValue: false,
        }),
      );
      if (!forceGen) {
        clack.cancel("Aborted.");
        process.exit(0);
      }
    }
    const created = generateOperatorKeyFile(dest, { force: true });
    generatedKeyFile = created.path;
    address = created.address;
    clack.log.success(`Created operator key at ${created.path}`);
    clack.log.info(`Your operator address: ${created.address}`);
  }
  if (!address && flags.keyFile) {
    address = addressFromKeyFile(flags.keyFile);
    clack.log.info(`Address from --key-file: ${address}`);
  }
  if (!address && hints.envAddress) {
    const useEnv = cancelIf(
      await clack.confirm({
        message: `Use OPERATOR_PRIVATE_KEY address (${hints.envAddress})?`,
        initialValue: true,
      }),
    );
    if (useEnv) address = hints.envAddress;
  }
  if (!address && hints.operator?.owner) {
    const useOp = cancelIf(
      await clack.confirm({
        message: `Keep existing owner (${hints.operator.owner})?`,
        initialValue: true,
      }),
    );
    if (useOp) address = hints.operator.owner;
  }
  if (!address) {
    const options = [
      {
        value: "__generate__",
        label: "Create a new operator key for me",
        hint: "writes ~/.clanker/op.key (recommended)",
      },
      {
        value: "__keyfile__",
        label: "Use an existing key file…",
        hint: "path to a 0x private key file",
      },
    ];
    if (hints.foundryAccounts.length) {
      for (const n of hints.foundryAccounts) {
        options.push({
          value: n,
          label: `Foundry: ${n}`,
          hint: "advanced — cast wallet",
        });
      }
    } else {
      options.push({
        value: "__foundry_missing__",
        label: "Foundry account…",
        hint: "advanced — install Foundry first",
      });
    }
    options.push({
      value: "__paste__",
      label: "Paste an address…",
      hint: "read-only unless you add a key later",
    });

    const pick = cancelIf(
      await clack.select({
        message: "How do you want to set your operator identity?",
        options,
        initialValue: "__generate__",
      }),
    );

    if (pick === "__generate__") {
      const dest = defaultOperatorKeyPath(home);
      let forceGen = flags.force;
      if (existsSync(dest) && !forceGen) {
        forceGen = cancelIf(
          await clack.confirm({
            message: `Overwrite existing ${dest}?`,
            initialValue: false,
          }),
        );
        if (!forceGen) {
          clack.cancel("Aborted.");
          process.exit(0);
        }
      }
      const created = generateOperatorKeyFile(dest, { force: true });
      generatedKeyFile = created.path;
      address = created.address;
      clack.log.success(`Created operator key at ${created.path}`);
      clack.log.info(`Your operator address: ${created.address}`);
    } else if (pick === "__keyfile__") {
      const path = cancelIf(
        await clack.text({
          message: "Path to operator key file",
          placeholder: join(home, "op.key"),
          validate: (v) =>
            v && String(v).trim() && existsSync(String(v).trim())
              ? undefined
              : "File not found",
        }),
      );
      generatedKeyFile = String(path).trim();
      address = addressFromKeyFile(generatedKeyFile);
      clack.log.info(`Address from key file: ${address}`);
    } else if (pick === "__foundry_missing__") {
      clack.log.warn(
        "Foundry (cast) is not available. Install https://book.getfoundry.sh/ or choose Create a new operator key.",
      );
      address = cancelIf(
        await clack.text({
          message: "Operator owner address",
          placeholder: "0x…",
          validate: (v) =>
            /^0x[0-9a-fA-F]{40}$/.test(v || "") ? undefined : "Need 0x + 40 hex",
        }),
      );
    } else if (pick === "__paste__") {
      address = cancelIf(
        await clack.text({
          message: "Operator owner address",
          placeholder: "0x…",
          validate: (v) =>
            /^0x[0-9a-fA-F]{40}$/.test(v || "") ? undefined : "Need 0x + 40 hex",
        }),
      );
    } else {
      foundryAccountUsed = pick;
      try {
        clack.log.step(`Resolving address for Foundry account "${pick}" (unlock if prompted)…`);
        address = resolveFoundryAddress(pick, {
          castBin: opts.castBin,
          spawn: opts.spawn,
          inheritStdio: true,
        });
        clack.log.success(`Foundry address: ${address}`);
      } catch (err) {
        clack.log.warn(err.message);
        address = cancelIf(
          await clack.text({
            message: `Paste 0x address for "${pick}"`,
            placeholder: "0x…",
            validate: (v) =>
              /^0x[0-9a-fA-F]{40}$/.test(v || "") ? undefined : "Need 0x + 40 hex",
          }),
        );
      }
    }
  }
  address = getAddress(address);

  let label = flags.operator || hints.operator?.label || null;
  if (!label) {
    label = cancelIf(
      await clack.text({
        message: "Operator label",
        placeholder: "org.openclaw.pat",
        validate: (v) => (v && v.trim() ? undefined : "Label required"),
      }),
    );
  }

  const presetCfg = PRESETS[preset];
  const spin = clack.spinner();
  spin.start(`Looking up "${label}" on ${preset}`);
  let check;
  try {
    check = await assertSetupIdentity({
      rpc: presetCfg.chainRpcUrl,
      registry: presetCfg.registryAddress,
      label,
      address,
      skipChainCheck: flags.skipChainCheck || !presetCfg.registryAddress,
    });
    spin.stop(
      check.unregistered
        ? c.yellow(`"${label}" not registered yet — mint after setup`)
        : check.skipped
          ? "Chain check skipped"
          : c.green(`"${label}" active and owned by this address`),
    );
  } catch (err) {
    spin.stop(c.red("Chain check failed"));
    throw err;
  }

  let keyFile = flags.keyFile || generatedKeyFile;
  let keyEnv = flags.keyEnv;
  let skipKey = flags.skipKey;
  if (!skipKey && !keyFile && !keyEnv) {
    if (foundryAccountUsed) {
      const doExport = cancelIf(
        await clack.confirm({
          message: `Export Foundry key for "${foundryAccountUsed}" to ~/.clanker/op.key for minting?`,
          initialValue: true,
        }),
      );
      if (doExport) {
        const dest = defaultOperatorKeyPath(home);
        clack.log.step("Exporting key via cast (unlock if prompted; key is not printed)…");
        const exported = exportFoundryKey(foundryAccountUsed, dest, {
          castBin: opts.castBin,
          spawn: opts.spawn,
          inheritStdio: true,
        });
        if (getAddress(exported.address) !== address) {
          throw new Error(
            `Exported key address ${exported.address} does not match owner ${address}`,
          );
        }
        keyFile = exported.path;
        clack.log.success(`Wrote ${keyFile} (mode 600)`);
      } else {
        skipKey = true;
      }
    } else if (hints.hasOperatorPrivateKeyEnv) {
      const use = cancelIf(
        await clack.confirm({
          message: "Store OPERATOR_PRIVATE_KEY pointer for signing?",
          initialValue: true,
        }),
      );
      if (use) keyEnv = "OPERATOR_PRIVATE_KEY";
      else skipKey = true;
    } else {
      const path = cancelIf(
        await clack.text({
          message: "Operator key file path (Enter = read-only)",
          placeholder: join(home, "op.key"),
        }),
      );
      if (path && String(path).trim()) keyFile = String(path).trim();
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

  clack.note(
    [
      `network:   ${preset}`,
      `fromBlock: ${fromBlock ?? presetCfg.fromBlock}`,
      `label:     ${label}`,
      `owner:     ${address}`,
      `signing:   ${key ? `${key.type}=${key.value}` : "none (read-only)"}`,
    ].join("\n"),
    "Summary",
  );

  if (!flags.yes) {
    const ok = cancelIf(
      await clack.confirm({ message: "Write these files?", initialValue: true }),
    );
    if (!ok) {
      clack.cancel("Aborted.");
      process.exit(0);
    }
  }

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

  clack.outro(c.green(`Wrote ${result.configPath}\nWrote ${result.operatorPath}`));
  if (!key) {
    nextHint([
      "clanker whoami",
      "clanker setup — choose Create a new operator key when you need mint",
    ]);
  } else if (preset === "sepolia" && generatedKeyFile) {
    nextHint(consumerFundHints({ address, label }));
  } else if (preset === "sepolia") {
    nextHint([
      "clanker fund",
      "clanker doctor",
      "clanker whoami",
      `clanker bot mint <label>`,
    ]);
  } else {
    nextHint(["clanker whoami", `clanker bot mint <label>`]);
  }
  return result;
}

/**
 * Entry: interactive if TTY (unless --yes with full flags), else non-interactive.
 */
export async function runSetup(argv, opts = {}) {
  const flags = parseSetupFlags(argv);
  const isTTY = opts.isTTY ?? Boolean(input.isTTY);
  const hasIdentitySource = Boolean(
    flags.address ||
      flags.keyFile ||
      flags.generateKey ||
      flags.foundryAccount ||
      opts.env?.OPERATOR_PRIVATE_KEY ||
      process.env.OPERATOR_PRIVATE_KEY,
  );

  if (!isTTY || (flags.yes && flags.preset && flags.operator && hasIdentitySource)) {
    if (!isTTY && !(flags.preset && flags.operator)) {
      return runSetupNonInteractive(argv, opts);
    }
    if (flags.yes && flags.preset && flags.operator && hasIdentitySource) {
      return runSetupNonInteractive(argv, opts);
    }
  }

  if (!isTTY) {
    return runSetupNonInteractive(argv, opts);
  }

  return runSetupInteractive(argv, opts);
}

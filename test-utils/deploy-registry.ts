/**
 * Shared test helper for the anvil-backed integration suites
 * (identity-service, mqtt-auth-service).
 *
 * Centralizes the `forge create ClankerIdentity` invocation so the contract's
 * constructor signature lives in exactly ONE place. When the constructor
 * changes, update this file — not every test that deploys the registry.
 */
// Deliberately dependency-free (no viem import): this helper lives at the repo
// root, outside any package's node_modules, so it must resolve nothing but Bun +
// Node built-ins. Callers (which live inside packages) bring their own viem.
export type Hex = `0x${string}`;

/** Well-known Anvil dev keys (accounts #0, #1, #2). Never use outside tests. */
export const ANVIL_DEFAULT_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as const;
export const ANVIL_KEY_1 =
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as const;
export const ANVIL_KEY_2 =
  "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a" as const;

/** Address of Anvil account #0 (matches ANVIL_DEFAULT_KEY). */
export const ANVIL_DEFAULT_ADDRESS =
  "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266" as const;

/** True when both `anvil` and `forge` are resolvable on PATH. */
export function foundryOnPath(): boolean {
  const r = Bun.spawnSync([
    "bash",
    "-lc",
    "command -v anvil >/dev/null && command -v forge >/dev/null",
  ]);
  return r.exitCode === 0;
}

export interface DeployedRegistry {
  registry: Hex;
  deploymentBlock: bigint;
}

export interface DeployTestRegistryOptions {
  rpcUrl: string;
  /** Absolute path to the `chain/` Foundry project. */
  chainDir: string;
  /** Deployer private key (defaults to Anvil account #0). */
  deployerKey?: Hex;
  /** Constructor fees in wei (default 0 — value-less register calls succeed). */
  operatorFeeWei?: bigint;
  botFeeWei?: bigint;
  /** Fee recipient; must be non-zero. Defaults to the deployer address. */
  feeRecipient?: Hex;
}

/**
 * Deploy a fresh `ClankerIdentity` to a running Anvil node via `forge create`.
 * Defaults to a zero-fee registry so tests can register without sending value.
 */
export async function deployTestRegistry(
  opts: DeployTestRegistryOptions,
): Promise<DeployedRegistry> {
  const deployerKey = opts.deployerKey ?? ANVIL_DEFAULT_KEY;
  const operatorFee = opts.operatorFeeWei ?? 0n;
  const botFee = opts.botFeeWei ?? 0n;
  // Any non-zero address works for a zero-fee registry (no ETH is forwarded).
  const feeRecipient = opts.feeRecipient ?? ANVIL_DEFAULT_ADDRESS;

  const deploy = Bun.spawn(
    [
      "forge",
      "create",
      "src/ClankerIdentity.sol:ClankerIdentity",
      "--rpc-url",
      opts.rpcUrl,
      "--private-key",
      deployerKey,
      "--broadcast",
      "--constructor-args",
      operatorFee.toString(),
      botFee.toString(),
      feeRecipient,
    ],
    { cwd: opts.chainDir, stdout: "pipe", stderr: "pipe" },
  );
  const exit = await deploy.exited;
  const combined =
    (await new Response(deploy.stdout).text()) +
    (await new Response(deploy.stderr).text());
  if (exit !== 0) {
    throw new Error(`forge create failed (exit ${exit}):\n${combined}`);
  }

  const m = combined.match(/Deployed to:\s*(0x[a-fA-F0-9]{40})/);
  const txm = combined.match(/Transaction hash:\s*(0x[a-fA-F0-9]{64})/);
  if (!m?.[1] || !txm?.[1]) {
    throw new Error(`forge create parse failed:\n${combined}`);
  }
  const registry = m[1] as Hex;

  const receipt = Bun.spawnSync(
    ["cast", "receipt", txm[1], "blockNumber", "--rpc-url", opts.rpcUrl],
    { stdout: "pipe" },
  );
  const bn = receipt.stdout.toString().trim();
  const deploymentBlock = BigInt(
    bn.startsWith("0x") ? Number.parseInt(bn, 16) : bn,
  );

  return { registry, deploymentBlock };
}

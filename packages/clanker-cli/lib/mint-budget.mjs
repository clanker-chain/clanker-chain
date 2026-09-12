/**
 * Mint ETH budget helpers: live registry fees + balance + CDP faucet claim estimate.
 */

import { formatEther, parseEther } from "viem";
import { clankerIdentityAbi } from "./clanker-identity-abi.mjs";
import { readOperator } from "./identity-query.mjs";
import { isLocalRpc } from "./profile.mjs";
import {
  ALCHEMY_BASE_SEPOLIA_FAUCET_URL,
  BASE_SEPOLIA_FAUCET_URL,
  CDP_FAUCET_DRIP_ETH,
} from "./operator-key.mjs";

/** Fixed gas cushion for one operator mint + one bot mint (no live estimateGas). */
export const MINT_GAS_RESERVE_WEI = parseEther("0.00005");

/** Documented CDP Base Sepolia ETH drip per claim (wei). */
export const CDP_FAUCET_DRIP_WEI = parseEther(CDP_FAUCET_DRIP_ETH);

/**
 * @param {bigint} wei
 * @returns {string}
 */
export function formatEthTrim(wei) {
  const s = formatEther(wei);
  if (!s.includes(".")) return s;
  const trimmed = s.replace(/\.?0+$/, "");
  return trimmed === "" ? "0" : trimmed;
}

/**
 * Ceiling of shortfall / drip (integer claims).
 * @param {bigint} shortfallWei
 * @param {bigint} [dripWei]
 * @returns {number}
 */
export function claimsNeeded(shortfallWei, dripWei = CDP_FAUCET_DRIP_WEI) {
  if (shortfallWei <= 0n) return 0;
  if (dripWei <= 0n) return 0;
  return Number((shortfallWei + dripWei - 1n) / dripWei);
}

/**
 * Pure budget math given fees, balance, and which fees remain.
 *
 * @param {{
 *   operatorFee: bigint,
 *   botFee: bigint,
 *   balance: bigint,
 *   needOperatorFee: boolean,
 *   needBotFee: boolean,
 *   gasReserve?: bigint,
 *   local?: boolean,
 * }} opts
 */
export function computeMintBudget(opts) {
  const gasReserve = opts.gasReserve ?? MINT_GAS_RESERVE_WEI;
  if (opts.local) {
    return {
      local: true,
      funded: true,
      balanceWei: opts.balance,
      operatorFeeWei: opts.operatorFee,
      botFeeWei: opts.botFee,
      gasReserveWei: gasReserve,
      feesWei: 0n,
      neededWei: 0n,
      shortfallWei: 0n,
      claimsNeeded: 0,
      needOperatorFee: false,
      needBotFee: false,
    };
  }

  let feesWei = 0n;
  if (opts.needOperatorFee) feesWei += opts.operatorFee;
  if (opts.needBotFee) feesWei += opts.botFee;
  // If nothing left to mint, needed is 0 (already funded for first operator+bot path).
  const effectiveNeeded =
    !opts.needOperatorFee && !opts.needBotFee ? 0n : feesWei + gasReserve;
  const shortfallWei =
    opts.balance >= effectiveNeeded ? 0n : effectiveNeeded - opts.balance;

  return {
    local: false,
    funded: shortfallWei === 0n,
    balanceWei: opts.balance,
    operatorFeeWei: opts.operatorFee,
    botFeeWei: opts.botFee,
    gasReserveWei: gasReserve,
    feesWei,
    neededWei: effectiveNeeded,
    shortfallWei,
    claimsNeeded: claimsNeeded(shortfallWei),
    needOperatorFee: opts.needOperatorFee,
    needBotFee: opts.needBotFee,
  };
}

/**
 * Read live fees + balance and decide remaining fees for the onboarding path.
 *
 * @param {{
 *   pub: { readContract: Function, getBalance: Function },
 *   registry: string,
 *   owner: string,
 *   rpc: string,
 *   operatorLabel?: string|null,
 *   mode?: 'onboarding'|'operator'|'bot',
 *   gasReserve?: bigint,
 * }} opts
 */
export async function assessMintBudget(opts) {
  const local = isLocalRpc(opts.rpc);
  if (local) {
    return computeMintBudget({
      operatorFee: 0n,
      botFee: 0n,
      balance: 0n,
      needOperatorFee: false,
      needBotFee: false,
      local: true,
      gasReserve: opts.gasReserve,
    });
  }

  if (!opts.registry || !/^0x[0-9a-fA-F]{40}$/.test(opts.registry)) {
    throw new Error("registry address required to assess mint budget");
  }

  const [operatorFee, botFee, balance] = await Promise.all([
    opts.pub.readContract({
      address: opts.registry,
      abi: clankerIdentityAbi,
      functionName: "operatorFee",
    }),
    opts.pub.readContract({
      address: opts.registry,
      abi: clankerIdentityAbi,
      functionName: "botFee",
    }),
    opts.pub.getBalance({ address: opts.owner }),
  ]);

  const mode = opts.mode ?? "onboarding";
  let needOperatorFee = false;
  let needBotFee = false;

  if (mode === "operator") {
    needOperatorFee = true;
    needBotFee = false;
  } else if (mode === "bot") {
    needOperatorFee = false;
    needBotFee = true;
  } else {
    // onboarding: operator + first bot unless operator already active
    needBotFee = true;
    needOperatorFee = true;
    if (opts.operatorLabel) {
      try {
        const op = await readOperator(opts.pub, opts.registry, opts.operatorLabel);
        if (op.active) {
          needOperatorFee = false;
        }
      } catch {
        // keep both fees if read fails
      }
    }
  }

  const budget = computeMintBudget({
    operatorFee: BigInt(operatorFee),
    botFee: BigInt(botFee),
    balance: BigInt(balance),
    needOperatorFee,
    needBotFee,
    gasReserve: opts.gasReserve,
    local: false,
  });

  return {
    ...budget,
    owner: opts.owner,
    registry: opts.registry,
    operatorLabel: opts.operatorLabel ?? null,
    faucetUrl: BASE_SEPOLIA_FAUCET_URL,
    backupFaucetUrl: ALCHEMY_BASE_SEPOLIA_FAUCET_URL,
    dripEth: CDP_FAUCET_DRIP_ETH,
  };
}

/**
 * Human-readable one-liner for doctor / fund.
 * @param {ReturnType<typeof computeMintBudget> & { dripEth?: string }} budget
 */
export function formatBudgetSummary(budget) {
  if (budget.local) {
    return "local RPC — Anvil accounts are prefunded";
  }
  if (budget.funded) {
    return `have ${formatEthTrim(budget.balanceWei)} ETH (need ${formatEthTrim(budget.neededWei)} ETH)`;
  }
  const parts = [];
  if (budget.needOperatorFee) parts.push(`operator fee ${formatEthTrim(budget.operatorFeeWei)}`);
  if (budget.needBotFee) parts.push(`bot fee ${formatEthTrim(budget.botFeeWei)}`);
  parts.push(`gas ~${formatEthTrim(budget.gasReserveWei)}`);
  const drip = budget.dripEth ?? CDP_FAUCET_DRIP_ETH;
  return (
    `have ${formatEthTrim(budget.balanceWei)} ETH, need ${formatEthTrim(budget.neededWei)} ETH` +
    ` (${parts.join(" + ")}). CDP ~${drip} ETH/claim → claim ~${budget.claimsNeeded} time(s)`
  );
}

/**
 * JSON-serializable budget fields (wei as strings).
 * @param {object} budget
 */
export function budgetToJson(budget) {
  return {
    local: Boolean(budget.local),
    funded: Boolean(budget.funded),
    balanceWei: String(budget.balanceWei ?? 0n),
    neededWei: String(budget.neededWei ?? 0n),
    shortfallWei: String(budget.shortfallWei ?? 0n),
    claimsNeeded: budget.claimsNeeded ?? 0,
    operatorFeeWei: String(budget.operatorFeeWei ?? 0n),
    botFeeWei: String(budget.botFeeWei ?? 0n),
    gasReserveWei: String(budget.gasReserveWei ?? 0n),
    needOperatorFee: Boolean(budget.needOperatorFee),
    needBotFee: Boolean(budget.needBotFee),
    owner: budget.owner ?? null,
    faucetUrl: budget.faucetUrl ?? BASE_SEPOLIA_FAUCET_URL,
    backupFaucetUrl: budget.backupFaucetUrl ?? ALCHEMY_BASE_SEPOLIA_FAUCET_URL,
    dripEth: budget.dripEth ?? CDP_FAUCET_DRIP_ETH,
  };
}

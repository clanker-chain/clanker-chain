/**
 * Mint budget helpers (mirror packages/clanker-cli/lib/mint-budget.mjs math).
 */

import { formatEther, parseEther } from "viem";
import { CDP_FAUCET_DRIP_ETH, MINT_GAS_RESERVE_ETH } from "./constants";

export const MINT_GAS_RESERVE_WEI = parseEther(MINT_GAS_RESERVE_ETH);
export const CDP_FAUCET_DRIP_WEI = parseEther(CDP_FAUCET_DRIP_ETH);

export function formatEthTrim(wei: bigint): string {
  const s = formatEther(wei);
  if (!s.includes(".")) return s;
  const trimmed = s.replace(/\.?0+$/, "");
  return trimmed === "" ? "0" : trimmed;
}

export function claimsNeeded(
  shortfallWei: bigint,
  dripWei: bigint = CDP_FAUCET_DRIP_WEI,
): number {
  if (shortfallWei <= 0n) return 0;
  if (dripWei <= 0n) return 0;
  return Number((shortfallWei + dripWei - 1n) / dripWei);
}

export type MintBudget = {
  funded: boolean;
  balanceWei: bigint;
  operatorFeeWei: bigint;
  botFeeWei: bigint;
  gasReserveWei: bigint;
  feesWei: bigint;
  neededWei: bigint;
  shortfallWei: bigint;
  claimsNeeded: number;
  needOperatorFee: boolean;
  needBotFee: boolean;
};

export function computeMintBudget(opts: {
  operatorFee: bigint;
  botFee: bigint;
  balance: bigint;
  needOperatorFee: boolean;
  needBotFee: boolean;
  gasReserve?: bigint;
}): MintBudget {
  const gasReserve = opts.gasReserve ?? MINT_GAS_RESERVE_WEI;
  let feesWei = 0n;
  if (opts.needOperatorFee) feesWei += opts.operatorFee;
  if (opts.needBotFee) feesWei += opts.botFee;
  const effectiveNeeded =
    !opts.needOperatorFee && !opts.needBotFee ? 0n : feesWei + gasReserve;
  const shortfallWei =
    opts.balance >= effectiveNeeded ? 0n : effectiveNeeded - opts.balance;

  return {
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

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseEther } from "viem";
import {
  claimsNeeded,
  computeMintBudget,
  formatEthTrim,
  formatBudgetSummary,
  MINT_GAS_RESERVE_WEI,
  CDP_FAUCET_DRIP_WEI,
  assessMintBudget,
} from "../lib/mint-budget.mjs";
import { CDP_FAUCET_DRIP_ETH } from "../lib/operator-key.mjs";

describe("mint-budget helpers", () => {
  it("formatEthTrim strips trailing zeros", () => {
    assert.equal(formatEthTrim(parseEther("0.001")), "0.001");
    assert.equal(formatEthTrim(parseEther("1")), "1");
    assert.equal(formatEthTrim(0n), "0");
  });

  it("claimsNeeded ceilings shortfall / drip", () => {
    assert.equal(claimsNeeded(0n), 0);
    assert.equal(claimsNeeded(CDP_FAUCET_DRIP_WEI), 1);
    assert.equal(claimsNeeded(CDP_FAUCET_DRIP_WEI + 1n), 2);
    // 0.00105 ETH / 0.0001 = 11 claims
    assert.equal(
      claimsNeeded(parseEther("0.001") + MINT_GAS_RESERVE_WEI),
      11,
    );
    // onboarding budget 0.00115 → 12
    assert.equal(
      claimsNeeded(
        parseEther("0.001") + parseEther("0.0001") + MINT_GAS_RESERVE_WEI,
      ),
      12,
    );
  });

  it("computeMintBudget local is always funded", () => {
    const b = computeMintBudget({
      operatorFee: parseEther("0.001"),
      botFee: parseEther("0.0001"),
      balance: 0n,
      needOperatorFee: true,
      needBotFee: true,
      local: true,
    });
    assert.equal(b.funded, true);
    assert.equal(b.local, true);
    assert.equal(b.neededWei, 0n);
  });

  it("onboarding needs operator + bot + gas", () => {
    const op = parseEther("0.001");
    const bot = parseEther("0.0001");
    const b = computeMintBudget({
      operatorFee: op,
      botFee: bot,
      balance: 0n,
      needOperatorFee: true,
      needBotFee: true,
    });
    assert.equal(b.neededWei, op + bot + MINT_GAS_RESERVE_WEI);
    assert.equal(b.funded, false);
    // 0.00115 / 0.0001 → 12 claims
    assert.equal(b.claimsNeeded, 12);
  });

  it("operator already exists only needs bot fee", () => {
    const op = parseEther("0.001");
    const bot = parseEther("0.0001");
    const balance = bot + MINT_GAS_RESERVE_WEI;
    const b = computeMintBudget({
      operatorFee: op,
      botFee: bot,
      balance,
      needOperatorFee: false,
      needBotFee: true,
    });
    assert.equal(b.neededWei, bot + MINT_GAS_RESERVE_WEI);
    assert.equal(b.funded, true);
    assert.equal(b.claimsNeeded, 0);
  });

  it("nothing left to mint => funded with zero needed", () => {
    const b = computeMintBudget({
      operatorFee: parseEther("0.001"),
      botFee: parseEther("0.0001"),
      balance: 0n,
      needOperatorFee: false,
      needBotFee: false,
    });
    assert.equal(b.funded, true);
    assert.equal(b.neededWei, 0n);
  });

  it("formatBudgetSummary mentions claim count when short", () => {
    const b = computeMintBudget({
      operatorFee: parseEther("0.001"),
      botFee: parseEther("0.0001"),
      balance: 0n,
      needOperatorFee: true,
      needBotFee: true,
    });
    const s = formatBudgetSummary({ ...b, dripEth: CDP_FAUCET_DRIP_ETH });
    assert.match(s, /need /);
    assert.match(s, /claim ~/);
  });

  it("assessMintBudget mode operator only needs operator fee", async () => {
    const opFee = parseEther("0.001");
    const botFee = parseEther("0.0001");
    const pub = {
      readContract: async ({ functionName }) => {
        if (functionName === "operatorFee") return opFee;
        if (functionName === "botFee") return botFee;
        throw new Error(`unexpected ${functionName}`);
      },
      getBalance: async () => 0n,
    };
    const b = await assessMintBudget({
      pub,
      registry: "0xD650467f9D7A20f37E55ec23Ca1c711598f97958",
      owner: "0x07e8CFD171E63915A441B0E8ff9E3CC2Cd27c4B4",
      rpc: "https://sepolia.base.org",
      mode: "operator",
    });
    assert.equal(b.needOperatorFee, true);
    assert.equal(b.needBotFee, false);
    assert.equal(b.neededWei, opFee + MINT_GAS_RESERVE_WEI);
  });

  it("assessMintBudget onboarding skips operator fee when active", async () => {
    const opFee = parseEther("0.001");
    const botFee = parseEther("0.0001");
    const owner = "0x07e8CFD171E63915A441B0E8ff9E3CC2Cd27c4B4";
    const pub = {
      readContract: async ({ functionName }) => {
        if (functionName === "operatorFee") return opFee;
        if (functionName === "botFee") return botFee;
        if (functionName === "operators") {
          return [owner, 1n, 0n];
        }
        throw new Error(`unexpected ${functionName}`);
      },
      getBalance: async () => botFee + MINT_GAS_RESERVE_WEI,
    };
    const b = await assessMintBudget({
      pub,
      registry: "0xD650467f9D7A20f37E55ec23Ca1c711598f97958",
      owner,
      rpc: "https://sepolia.base.org",
      operatorLabel: "org.you",
      mode: "onboarding",
    });
    assert.equal(b.needOperatorFee, false);
    assert.equal(b.needBotFee, true);
    assert.equal(b.funded, true);
  });
});

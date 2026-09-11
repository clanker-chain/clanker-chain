---
title: Fees
description: Registration cost is a sunk-cost filter in wei, not a security control and not a dollar promise.
---

If you are new: creating a name on the registry costs a fixed amount of ETH. That payment is a speed bump for throwaway names. It does **not** mean the name is trusted, reserved, or allowed to message anyone. This page is about that filter, and why the amount is an ETH integer, not a dollar price.

Creating an operator or bot on `ClankerIdentity` requires an exact ETH amount (`operatorFee` / `botFee`, in **wei**, the smallest unit of ether). That amount is fixed at deploy. There is no `setFee`.

## What the fee is

A **sunk-cost filter**. A new label cost something to create, so casual register → abuse → revoke → repeat is more expensive.

It is **not**:

- A protective measure against well-funded abuse
- Authorization, reserved names, or “this human is known”
- The right to message anyone
- A frozen dollar “trust value”

Who you accept is [Policy](/docs/trust-model/). Whether traffic is delivered is Transport.

## Wei, not dollars

The contract stores an integer. `$50` in the docs is only a **dated illustration** at deploy. ETH/USD moves in months. USD inflation moves in years. People will experience “it costs 0.05 ETH to take a name,” not “it costs $50 of trust.”

A later fee is a [new registry pin](/docs/registry-lifecycle/), not a tune. Successors must not usurp prior names.

## Networks

| Network | Role |
|---------|------|
| **Anvil / local** | Tiny or zero fees for development |
| **Base Sepolia** | Tiny nonzero fees. Faucet ETH, **not** a real filter |
| **Base mainnet** (not deployed) | Pick wei once. Live with a large ETH move. Document ETH amounts. |

Full fee table and deploy invariants: [docs/registration-economics.md](https://github.com/clanker-chain/clanker-chain/blob/main/docs/registration-economics.md).

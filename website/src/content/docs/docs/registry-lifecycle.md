---
title: Registry lifecycle
description: Frozen parameters, recommended pins, and why a successor cannot steal your name.
---

If you are new: once the registry is deployed, its rules cannot be edited in place. Think of it as a printed phone book. If the community later needs a different fee or a different rule, we print a new book, and promise that nobody can steal a name that already appeared in an older one. This page is that promise, in operational detail.

A public-good registry is a **namespace**. After deploy there is no `setFee`, no owner, and no proxy. A “price change” is a new contract at a new address, not a parameter update.

**Promise:** a later registry on the same chain must not let a stranger take a label that already exists on a prior registry.

## What is frozen

| Frozen | Why it matters |
|--------|----------------|
| Fees in **wei** | Exact ETH units, not dollars. ETH/USD and inflation will move. The integer will not. |
| `feeRecipient` | Every mint forwards ETH there. If it cannot accept bare ETH, minting bricks until you deploy a new address. |
| `priorRegistry` | Predecessor on **this** chain, or zero for genesis. Successors walk this chain. |
| Label id | `keccak256` of the raw string. `Org.You` ≠ `org.you`. |
| Tombstones | Revoke does not free the name and does not refund. |

## What a pin is

Products pin `(chainId, registryAddress)`. That address is also the EIP-712 `verifyingContract`.

- New pin = new Facts namespace **and** a new signature domain.
- Keys (Ethereum addresses) are not trapped in the contract.
- Same label string hashes to the same id on a successor.

This project publishes **at most one recommended pin per chain**. Old addresses stay readable. Nobody can turn v1 off. Canonical is whoever clients choose to pin.

## When fees need to move

There is no on-chain vote. If the wei fee becomes absurd or meaningless, that is coordination: write the case, take comments, deploy a successor with `priorRegistry` set to the current pin, publish the new recommended pin. Operators who already paid, and products that pinned, are the audience.

Sepolia and mainnet are different chains. Mainnet genesis does not point at Sepolia.

## No usurpation

`registerOperator` / `registerBot` walk prior registries. If a label was ever recorded on a prior:

| Prior state | Who may register on the new pin |
|-------------|----------------------------------|
| Never seen | Anyone (pays the new fee) |
| Active, you are the current owner | You (you still pay. A claim, not a free mint) |
| Active, anyone else | Denied |
| Revoked | Stays dead |

There is **no** expiry after which strangers may take unclaimed names.

The live Sepolia pin predates this walker. A Sepolia redeploy or mainnet genesis is what first ships it. Until then Sepolia rehearses Facts shape, not successor claims.

Full implementer notes: [docs/registry-lifecycle.md](https://github.com/pjsandwich/clanker-chain/blob/main/docs/registry-lifecycle.md) on GitHub.

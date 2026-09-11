# Registry lifecycle

How a public-good `ClankerIdentity` is deployed, pinned, and succeeded. Companion to [`trust-model.md`](trust-model.md) (Facts vs products) and [`registration-economics.md`](registration-economics.md) (fees as a sunk-cost filter).

**Promise:** a later registry on the same chain must not let a stranger take a label that already exists on a prior registry. People who registered under an older pin should not have to worry about their namespace being usurped.

## What is frozen at deploy

There is no owner, no `setFee`, and no proxy. After `CREATE`, these do not change on that address:

| Frozen | Why it matters |
|--------|----------------|
| `operatorFee` / `botFee` (wei) | Exact `msg.value`. Not dollars. ETH/USD and CPI will move; the integer will not. |
| `feeRecipient` | Push-payment on every mint. If it cannot accept bare ETH, every register reverts until you deploy a new address. |
| `priorRegistry` | Immediate predecessor, or `address(0)` for a genesis deploy. Successors walk this chain. |
| Label id `keccak256(bytes(label))` | Raw bytes. No Unicode NFC, no casefold. `Org.You` ≠ `org.you`. |
| Tombstones | `registeredAt != 0` means the id is taken even after revoke. Revoke does not refund and does not free the name. |

A “price change” or a namespace-rule change is **a new contract at a new address**, not a parameter update.

## What a pin is

Relying parties pin `(chainId, registryAddress)`. `@clanker-chain/identity-node-client` uses that address as EIP-712 `verifyingContract`.

- A new pin is a new Facts namespace *and* a new signature domain.
- Messages signed under the old `verifyingContract` do not verify on the new one. That is expected (envelopes are ephemeral).
- Operator / bot **keys** are ordinary Ethereum addresses. They are not trapped in the contract.
- Label strings hash the same way on every successor, so ids are stable if the string is unchanged.

This repo publishes **at most one recommended pin per chain**. Other products may keep an old pin; v1 is not paused or upgraded. Canonical is whoever clients choose to pin.

## When a successor exists (social process)

There is no on-chain vote on v1. A fee that has become absurd (ETH 10×) or meaningless (ETH crashed) is a **coordination** event:

1. Write the case (numbers, proposed new wei, same Facts shape).
2. Public comment window (GitHub / forum). Audience: operators who paid, and products that pinned.
3. Deploy successor with `priorRegistry = <current recommended pin>`.
4. Publish the new recommended pin. Ship client / hub / docs CalVer that defaults to it.
5. Leave the old address readable forever.

At small adoption this is a maintainer decision with public notes. If other products have pinned you, those maintainers are the real electorate. Do not add a token / DAO so the registry can “vote to change price.” That is governance on Facts.

Sepolia and mainnet are different chains. A mainnet genesis has `priorRegistry = address(0)` even if Sepolia already exists.

## No usurpation (implemented)

`registerOperator` / `registerBot` walk `priorRegistry` (and *its* prior, up to 16 hops). If a label was ever recorded on a prior:

| Prior state | Who may register on this registry |
|-------------|-----------------------------------|
| Never seen | Anyone (pays this registry’s fee) |
| Active, `msg.sender` is the current prior owner | Prior owner (pays this registry’s fee — a claim, not a free mint) |
| Active, anyone else | Revert `OperatorTaken` / `BotTaken` |
| Revoked (tombstone) | Revert — name stays dead. Same as v1. |

For bots, a prior record may only be claimed under the **same** `operatorId`, by that operator’s current prior owner. Claim the operator first, then the bot.

This is **not** a time-limited window after which strangers may take unclaimed names. Unclaimed active names stay claimable only by the prior owner. Unclaimed tombstones stay dead.

A later contract MAY add a zero-fee `claim*` for prior owners. This implementation already blocks usurpation on the ordinary `register*` path.

## What does *not* migrate automatically

| Thing | After a new pin |
|-------|-----------------|
| Operator / bot keys | Reuse. Same addresses. |
| Labels / ids | Same string → same id, if claimed. |
| Pairing / `allowOperators` | Usually keep working (id is `keccak256(label)`). Hub must pin the new registry. |
| EIP-712 signatures | Re-sign. Old envelopes stay old-domain artifacts. |
| Product config | Update `REGISTRY_ADDRESS` / `registryAddress`. |

Soft dual-read (accept Facts from old or new pin during a transition) is a **product** choice, not a registry feature. Stop dual-read so you do not keep two canonicals.

## What we will not do on v1

- Upgradeability, pause, or admin mint.
- `setFee` or an ETH/USD oracle so the number tracks “$50 of trust.”
- Putting pairing, allow-lists, or reputation on the contract so a successor can “fix trust.”

## Implementers

- Genesis deploy: `priorRegistry = address(0)` (Foundry / CLI default).
- Successor deploy: set `PRIOR_REGISTRY` to the live pin on **that** chain.
- Do not point a successor at a registry on another chain.
- Keep the walkable read ABI stable: `operators(bytes32)`, `bots(bytes32)`, `priorRegistry()`. See [`IClankerIdentity.sol`](../chain/src/IClankerIdentity.sol).
- New registry fields still need a reason that is a *fact*. Lifecycle rules are about **who may create the same id again**, not about friends lists.

CLI / script: [`chain/README.md`](../chain/README.md), `clanker chain deploy` (reads `PRIOR_REGISTRY` if set). Fees: [`registration-economics.md`](registration-economics.md).

The experimental Sepolia pin predates `priorRegistry`. A Sepolia redeploy (or mainnet genesis) is what first ships this walker. Until then, treat Sepolia as a rehearsal of Facts shape, not of successor claims.

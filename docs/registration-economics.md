# Registration economics (`ClankerIdentity`)

Why and how operator/bot registration fees work on the canonical registry.

## Why fees

Fees make creating a new Facts record a **sunk cost**. That is a **filter**: casual register → abuse → revoke → repeat gets more expensive. It is **not** a security control and **not** a protective measure against nefarious activity. Someone who intends harm and has a budget will pay `operatorFee` / `botFee`.

Verifiers should treat a paid registration as “this label exists and cost something to create,” never as “this operator is safe to talk to.” Who you accept is Policy. Whether traffic is delivered is Transport. → [`trust-model.md`](trust-model.md)

Fees are enforced **in the smart contract**, not in CLI config or OpenClaw. Verifiers pin one canonical `(chainId, registryAddress)`; copying the contract bytecode to another address does not grant entries in the canonical registry. Changing the fee is a **new pin**, not `setFee`. Successors must not usurp prior labels. → [`registry-lifecycle.md`](registry-lifecycle.md)

## What is charged

| Action | Fee |
|--------|-----|
| `registerOperator` | `operatorFee` (immutable, exact `msg.value`) |
| `registerBot` | `botFee` (immutable, exact `msg.value`) |
| `rotateBotKey` | None |
| `revokeBot` / `revokeOperator` | None (non-refundable; prior fee already forwarded) |
| Operator transfer | None |

Fees are **forwarded to `feeRecipient`** on each successful register. There is no `withdraw()` accumulator and no `setFee` — deploy-time constants only.

## Anti-$0 invariant

- Only `registerOperator` and `registerBot` create records; both are `payable` with `WrongFee` if `msg.value` does not match.
- No privileged free-mint path for admins.
- A forked client cannot waive fees; only calling the canonical contract with correct `msg.value` creates an on-chain identity.

## Trust model

**Facts · Policy · Transport** — Fees buy a **Facts** record (this label exists and cost something to create). They do **not** buy trust, reserved names, abuse protection, or the right to message anyone. Friends lists stay in products. → [`trust-model.md`](trust-model.md)

- **Canonical registry:** publish `REGISTRY_ADDRESS` per network (Base Sepolia, Base mainnet). All relying parties (`mqtt-auth-service`, OpenClaw bots via `IdentityClient` / `RegistryClient`) use that address as EIP-712 `verifyingContract`.
- **Clones at other addresses** are separate namespaces; they do not affect the canonical registry.

## Deploy parameters

Set before `forge script script/Deploy.s.sol:Deploy`:

| Env var | Role |
|---------|------|
| `OPERATOR_FEE_WEI` | Wei per `registerOperator` |
| `BOT_FEE_WEI` | Wei per `registerBot` |
| `FEE_RECIPIENT` | Recipient of forwarded fees (typically a Safe; must be non-zero) |

### Deploy invariant: `feeRecipient` must accept ETH

`feeRecipient` is **immutable**. On each successful register, the contract forwards `msg.value` with a bare ETH transfer (`feeRecipient.call{value: msg.value}("")`). If the recipient **reverts** on plain ETH (e.g. a contract without a `payable` `receive`/fallback, or certain Safe guard configurations), **every** `registerOperator` / `registerBot` reverts `FeeTransferFailed` and registration is permanently bricked until you **redeploy** a new registry and re-point all verifiers.

**Before mainnet deploy:**

- Use an **EOA** or a contract known to accept plain ETH transfers.
- Smoke-test: send a tiny `registerOperator` on the target network and confirm `feeRecipient` balance increases.
- If you need a recipient that cannot accept direct ETH, consider a future **pull-payment** design (`withdraw()` accumulator) — not implemented in v1.

Read deployed values:

```bash
cast call $REGISTRY "operatorFee()(uint256)" --rpc-url $CHAIN_RPC_URL
cast call $REGISTRY "botFee()(uint256)" --rpc-url $CHAIN_RPC_URL
cast call $REGISTRY "feeRecipient()(address)" --rpc-url $CHAIN_RPC_URL
```

## Staging vs production targets

| Network | Operator fee | Bot fee | Notes |
|---------|--------------|---------|-------|
| **Base Sepolia** | ~0.001 ETH | ~0.0001 ETH | Tiny nonzero — exercises payable path; faucet ETH is not a sunk-cost filter |
| **Base mainnet** | Pick wei once (live with ~5× ETH move) | Same | Dated USD *illustration* only (e.g. ≈ $50–100 / $10–25 at deploy). Not a dollar promise. |

Convert a USD *illustration* to wei at deploy time using spot ETH/USD. After deploy the integer is the protocol. A later fee is a new registry + pin ([`registry-lifecycle.md`](registry-lifecycle.md)), not a tune.

## Open decisions

Decide these against a shared Sepolia hub, not against LAN smoke. Sequence: [`public-testnet-hub.md`](public-testnet-hub.md).

- **Namespace policy:** FCFS with fees vs reserving `org.openclaw.*` at genesis vs ENS-gated operators. Genesis requires a **new** registry — choose before inviting strangers if Sepolia should look like mainnet.
- **Mainnet fee amounts:** pick wei once (Sepolia can inform *shape* — exact fee, tombstone, claim — not a ten-year dollar story).
- **`feeRecipient`:** Safe multisig recommended from day one on mainnet; must accept plain ETH (see deploy invariant above). Live Sepolia `feeRecipient` is Foundry `0x07e8…` (not Anvil; Anvil `0xf39F…` is local-dev only).

## CLI

Prefer profile-aware commands ([`operator-cli.md`](operator-cli.md)): `clanker operator mint` / `clanker bot mint`. Low-level aliases `clanker chain mint-operator` / `mint-bot` remain. All of them read `operatorFee` / `botFee` from the deployed registry and send the exact `msg.value` required. Works with zero-fee and nonzero-fee deploys. On non-local RPCs the CLI refuses Anvil account #0 as the operator key.

See also: [`chain/README.md`](../chain/README.md), [`archive/blockchain-identity-plan.md`](archive/blockchain-identity-plan.md) (historical).

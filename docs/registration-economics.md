# Registration economics (`ClankerIdentity`)

Why and how operator/bot registration fees work on the canonical registry.

## Why fees

Identity is valuable to verifiers (MQTT CONNECT, EIP-712 message verify, future reputation) when creating a new bot identity has a **sunk cost**. Cheap or free registration makes Sybil churn — register, abuse, revoke, repeat — economical.

Fees are enforced **in the smart contract**, not in CLI config or OpenClaw. Verifiers pin one canonical `(chainId, registryAddress)`; copying the contract bytecode to another address does not grant entries in the canonical registry.

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
| **Base Sepolia** | ~0.001 ETH | ~0.0001 ETH | Tiny nonzero — exercises payable path; no real sunk cost |
| **Base mainnet** (starting point) | ~$50–100 USD in ETH | ~$10–25 USD in ETH | Tune bot fee up if churn remains cheap |

Convert USD targets to wei at deploy time using spot ETH/USD. Mainnet deploy is a **new contract** with new constructor args (fees are immutable).

## Open decisions

- **Namespace policy:** FCFS with fees vs reserving `org.openclaw.*` at genesis vs ENS-gated operators.
- **Mainnet fee amounts:** set from observed Sepolia behavior and abuse tolerance.
- **`feeRecipient`:** Safe multisig recommended from day one on mainnet; must accept plain ETH (see deploy invariant above).

## CLI

`clanker chain mint-operator` and `clanker chain mint-bot` read `operatorFee` / `botFee` from the deployed registry and send the exact `msg.value` required. Works with zero-fee and nonzero-fee deploys.

See also: [`chain/README.md`](../chain/README.md), [`blockchain-identity-plan.md`](blockchain-identity-plan.md).

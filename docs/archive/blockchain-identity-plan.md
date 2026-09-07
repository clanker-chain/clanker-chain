# Blockchain identity plan

> **Historical archive.** Do not implement from this document.
>
> The cutover it describes shipped in PRs [#12](https://github.com/pjsandwich/clanker-chain/pull/12) (chain + SIWE/EIP-712), [#17](https://github.com/pjsandwich/clanker-chain/pull/17) (registration fees), and [#18](https://github.com/pjsandwich/clanker-chain/pull/18) (chain-direct reads; identity-service off the hub path).
>
> Current operator docs: [`SETUP.md`](../../SETUP.md), [`chain/README.md`](../../chain/README.md), [`docs/registration-economics.md`](../registration-economics.md).

---

Plan for migrating clanker-chain's bot/operator identity from a JSON-file ledger served by `identity-service` to an on-chain registry, while keeping the data plane (MQTT messaging, OpenClaw plugin) unchanged.

This is a planning doc. No code changes are implied by reading it.

---

## 1. Where we stood (pre-cutover snapshot)

> **Note:** CalVer `2026.5.23` completed the hard cutover (see §1 status below). This subsection describes the legacy JSON ledger for historical context.

The former identity stack was signature-rooted and replayable. The "ledger" file was closer to a single-writer rollup than to a config file.

- `identity/bot-identity-ledger.json` was an append-only log of `operations[]` (`mint-operator`, `mint-bot`, `add-bot-key`), each with `message`, `signature`, `timestamp`, `op_id`.
- `identity-service` verified writes with Ed25519 before mutating state.
- `mqtt-auth-service` accepted EdDSA JWT CONNECT passwords.
- Bot keys were Ed25519 at `~/.openclaw/keys/{bot_id}.key`.

What worked:

- Cryptographic provenance for every state change.
- Anyone could re-run the identity service against the same ledger and recompute identical state.
- Brokers never trusted a username/password DB — every CONNECT was a signature check.

What was missing for "actually a blockchain":

1. **Single writer.** One JSON file behind one Bun process with an in-process write lock. Two operators on two machines can't both append.
2. **Tamper-evidence.** Operations are signed individually but not chained (no `prev_hash`); the host could rewrite history undetectably.
3. **Sybil at the genesis edge.** Anyone can self-sign a `mint-operator` and claim any unused operator id.
4. **Revocation freshness.** Relying parties trust whatever the identity service returns now — no inclusion proof, no "as-of block".
5. **Cross-org governance.** No multi-sig, no recovery, no shared control of an operator id.
6. **Public auditability.** Reputation needs a public, append-only feed nobody can rewrite.

### Current integration status (CalVer 2026.5.23 — hard cutover)

- **`chain/`** — `ClankerIdentity`, Foundry tests, `clanker chain up|deploy|mint-*`.
- **identity-service** — EVM-only read API; indexes chain events; `GET /health` exposes EIP-712 domain.
- **mqtt-auth-service** — SIWE-only CONNECT verification.
- **identity-node-client** — secp256k1 keys, SIWE MQTT, EIP-712 message signing.
- **No** JSON ledger writes, Ed25519 keys, or JWT CONNECT (legacy paths removed).

---

## 2. Decisions

These are the framing choices that drive everything below.

| Decision | Choice | Implication |
| --- | --- | --- |
| Dev environment | Local-only chain on the LAN | Use Anvil (Foundry); bots reach it like they reach Mosquitto. |
| Production target | Public-good chain | Deploy to Base (cheap L2, EAS native, OP-stack ecosystem). |
| Operator type | Humans / organizations | Operator ownership = EOA or Safe multisig. |
| Wire signature scheme | Adopt smart-contract community standard | **Switch from Ed25519 to secp256k1 / Keccak-256**, EIP-712 typed data, EIP-4361 (SIWE) for CONNECT. |
| Finality latency | Long delays acceptable, even preferred | Age-of-identity is a reputation primitive; on-chain confirmation latency is a feature, not a bug. |

---

## 3. Crypto migration

The smart-contract ecosystem standardizes on **secp256k1 keypairs**, **Keccak-256** hashing, **ecrecover** verification, and **EIP-712** signing envelopes. Switching to this stack buys interoperability with every Ethereum wallet, library, and tool, and makes on-chain verification cheap (~3000 gas).

### What changes on the wire

- **Bot keys**: 32-byte secp256k1 private key on disk, 20-byte Ethereum address as the public identifier. Replace `algorithm: "ed25519"` records in the ledger with `algorithm: "secp256k1"`. File layout in `~/.openclaw/keys/{bot_id}.key` can stay the same.
- **MQTT CONNECT auth**: keep `username = bot_id`. **Shipped:** SIWE-style **EIP-191 `personal_sign`** (not full EIP-4361) on the ASCII string `clanker-mqtt:auth:<bot_id>:<nonce>` where `nonce` is issued by `mqtt-auth-service` (`GET /nonce?bot_id=…`). CONNECT `password` is `<nonce>.<signatureHex>` (65-byte ECDSA sig). `mqtt-auth-service` uses `viem`’s `recoverMessageAddress`, compares to the active `secp256k1-eth` / `botKey` from `GET /v1/bots/:id`. Legacy EdDSA JWT path **removed** in CalVer `2026.5.23`.
- **Per-message signatures**: the canonical-fields list in `bot-comms.md` stays the same, but they're hashed under an **EIP-712 typed-data domain** instead of sorted JSON + Ed25519:

  ```text
  domain  = { name: "ClankerChain", version: "1", chainId, verifyingContract }
  types   = { Message: [from, from_id, operator_id, to, to_id, type, subtype,
                        timestamp, message_id, correlation_id, body] }
  ```

  Verifiers do `ecrecover(hash, sig) == bot.botKey`. Wallets and Etherscan can render the prompt human-readably, which becomes useful if a human ever co-signs.

### Code touched

- `identity-service/src/crypto.ts` — add `verifySecp256k1` / `recoverAddress` helpers (or use `viem`'s `recoverMessageAddress`).
- `identity-service/src/ledger.ts` — `algorithm` field already exists in `PublicKeyRecord`; record contents change, schema doesn't.
- `mqtt-auth-service/src/server.ts` — swap verifier; username semantics unchanged.
- `openclaw-extensions/mqtt-channel-plugin/src/MqttChannelProvider.ts` — token minting uses an EVM signer (`viem` `WalletClient`) instead of `IdentityClient.signJwt(...)`.
- `bot-comms.md` §"Canonical Signing Format" — replace canonical JSON + Ed25519 with EIP-712 domain + types.
- `clanker-cli/bin/clanker.mjs` — `mint` subcommand generates secp256k1 keys.

This migration is **independent of the chain** — it can ship before the contract exists, with backwards compatibility for Ed25519 keys during cutover (see PR sequence below).

---

## 4. Local dev stack

| Component | Tool | Notes |
| --- | --- | --- |
| Chain node | **Anvil** (Foundry) | Run with `anvil --host 0.0.0.0 --state state.json` so bots on other LAN machines can reach it and state survives restarts. |
| Build / test | **Foundry** (`forge`, `cast`) | Single binary install. Solidity tests run in Rust; very fast. |
| TS client | **viem** | Replaces `@clanker-chain/identity-node-client` for chain reads/writes. Strongly typed, supports EOA + Safe via the same `WalletClient`. |
| Project layout | New `chain/` dir at repo root | `chain/src/ClankerIdentity.sol`, `chain/test/`, `chain/script/Deploy.s.sol`. |

The **implemented** Foundry package and local commands are documented in [`chain/README.md`](../chain/README.md): `ClankerIdentity` (minimal operator/bot registry), `forge test`, and `node clanker-cli/bin/clanker.mjs chain up|deploy` from the repo root (or a globally linked `clanker` binary). On-chain `mint-operator` / `mint-bot` CLI helpers are planned next; until then, interact with the contract via `cast send` or a small script (examples in `chain/README.md`).

Local dev flow:

```bash
cd chain && forge test -vvv
node clanker-cli/bin/clanker.mjs chain up       # Anvil; default state file: chain/.anvil-state.json
node clanker-cli/bin/clanker.mjs chain deploy   # Deploy ClankerIdentity (defaults: local RPC + Anvil account #0)
```

Migration to public chain is two env vars: `CHAIN_RPC_URL` and `REGISTRY_ADDRESS`. ABI and code unchanged.

### Manual registration with `cast` (until `clanker chain mint-*` exists)

Full examples and pitfalls live in [`chain/README.md`](../chain/README.md). Short rules:

- **`--rpc-url` and `--private-key` before** the contract address and function (avoids parser errors with some `cast` versions).
- **`OP_ID` / `BOT_ID`** = `keccak256(bytes(label))` → use `cast keccak $(cast from-utf8 "your.label.here")`. Do **not** confuse that `bytes32` with a **private key** (`PK` must be a 32-byte secp256k1 secret, e.g. Anvil’s well-known dev keys).
- **`registerOperator`** must be sent from the account that should **own** that operator; **`registerBot`** must use the **same** `--private-key` as that operator’s `owner`.
- **`botKey`** in `registerBot` is an **Ethereum address** (the bot’s future signing identity on-chain). Two bots cannot share the same active `botKey` (`botKeyToId` enforces uniqueness).

---

## 5. Public chain choice

Ranked for our use case (public-good identity registry, cheap, EAS-friendly, OP-stack):

1. **Base** — Coinbase L2, ~1¢/tx, EAS deployed natively, ENS L2 resolution shipping. Recommended.
2. **Optimism mainnet** — same OP-stack, more established, slightly pricier.
3. **Arbitrum One** — solid tech, but the attestation/identity ecosystem is denser on OP-stack.

Avoid Ethereum L1 (gas) and avoid building an app-rollup (overkill).

Test/staging deploy: **Base Sepolia** (free, same code).

---

## 6. Registry contract (`ClankerIdentity`)

**Source of truth in repo:** [`chain/src/ClankerIdentity.sol`](../chain/src/ClankerIdentity.sol). The contract is intentionally minimal (notary only): **no** metadata URI, **no** status enum on-chain — “active” means `revokedAt == 0`; revoked records keep `registeredAt` and set `revokedAt`.

**Registration fees (v2):** `registerOperator` and `registerBot` are **payable** with **immutable** `operatorFee` and `botFee` set at deploy. `msg.value` must match exactly or the tx reverts `WrongFee`. Fees are **forwarded to an immutable `feeRecipient`** on each register — enforcement is **on-chain**, not in `identity-service` or CLI config. See [`docs/registration-economics.md`](registration-economics.md). `rotateBotKey`, revoke, and transfer are not charged. This shape is intended for Base Sepolia (near-zero fees) and Base mainnet (production sunk-cost targets).

**Ids:** `bytes32 operatorId = keccak256(bytes(operatorLabel))` and `bytes32 botId = keccak256(bytes(botLabel))` (e.g. labels `org.openclaw.pat`, `openclaw.france.prod-1`). **`msg.sender` must be the operator owner** to register or manage bots under that operator.

**Storage**

| Field | Purpose |
| --- | --- |
| `operatorFee`, `botFee`, `feeRecipient` | Immutable fee config (constructor) |
| `operators(bytes32)` | `owner`, `registeredAt`, `revokedAt` |
| `bots(bytes32)` | `operatorId`, `botKey` (20-byte signing address), `registeredAt`, `revokedAt` |
| `pendingOperatorOwner(bytes32)` | Two-step operator transfer |
| `botKeyToId(address)` | At most one active bot per `botKey` |

**Functions:** `registerOperator` (payable), `proposeOperatorTransfer`, `acceptOperatorTransfer`, `revokeOperator`, `registerBot` (payable), `rotateBotKey`, `revokeBot`. Custom errors include `WrongFee`, `FeeTransferFailed`, plus existing notary errors.

**Events:** `OperatorRegistered`, `OperatorTransferProposed`, `OperatorTransferred`, `OperatorRevoked`, `BotRegistered`, `BotKeyRotated`, `BotRevoked`. Indexers replay these to build off-chain views and (future) the `IdentityLedger` cache. Event shapes are unchanged; only register txs now carry value.

### Design notes

- **Operator id = hash of chosen label, not the owner address.** Readable labels off-chain; on-chain id is fixed bytes32. First-come-first-served on local dev. For prod, fees + namespace policy gate registration — see [`registration-economics.md`](registration-economics.md) and §10.
- **`botKey` is an EVM `address`.** Aligns with secp256k1 + `ecrecover` on the wire (§3). `mqtt-auth-service` can verify CONNECT via that address (SIWE-style, §3) while legacy bots still use Ed25519 JWTs from the JSON ledger.
- **`registeredAt` / `revokedAt` + block timestamps on events** — age and history for reputation indexers without extra on-chain fields.
- **No admin token.** Only `msg.sender` checks against `operators[id].owner` (and two-step accept for transfers). No `setFee`, no free-mint bypass.

---

## 7. Reputation primitives

### Derivable from the shipped registry (no extra contracts)

- **Operator / bot age:** `block.timestamp - registeredAt` from storage or mint tx time.
- **Revocation history:** `OperatorRevoked`, `BotRevoked` events plus `revokedAt` on structs.
- **Operator → bot count:** count `BotRegistered` where `operatorId` matches.
- **Key rotation cadence:** `BotKeyRotated`, `OperatorTransferred` events.

These are free for any indexer reading logs + occasional `eth_call`.

### Add as separate contracts when needed

- **EAS (Ethereum Attestation Service) integration.** EAS is deployed on Base/Optimism with a public schema registry. Define schemas like `BotCompletedTask(bytes32 botId, bytes32 taskId, uint8 outcome)` or `OperatorEndorsesOperator(bytes32 from, bytes32 to, uint8 score)`. Subjective reputation lives here, decoupled from the registry.
- **Activity anchoring.** Bots periodically publish a Merkle root of their recent signed messages: `function anchorActivity(bytes32 botId, bytes32 root, uint64 windowStart, uint64 windowEnd)`. Off-chain readers count anchors per window as an activity proxy and can challenge with inclusion proofs. Cheaper than logging every message; sybil-priced by gas.
- **ENS resolution.** Operators register `pat.openclaw.eth`; resolver maps operator_id ↔ ENS name. Adds discoverability without changing the registry.
- **Stake and slashing.** Skip until you have a real abuse vector. It's a tar pit if added pre-emptively.

---

## 8. Code seams

Three interfaces to introduce in the existing repo. Each is shippable on its own and unblocks the chain work without forking the codebase.

### 8a. `IdentityBackend` interface

In `identity-service/src/backend.ts` (types remain in `ledger.ts`). `JsonFileBackend implements IdentityBackend`. Later, add `EvmBackend implements IdentityBackend` that materializes the same shape from contract events. The HTTP layer in `identity-service/src/server.ts` only knows the interface; `mqtt-auth-service`, `MqttChannelProvider`, and `clanker-cli` never need to learn about chains.

```ts
interface IdentityBackend {
  getBot(id: string): Promise<BotRecord | undefined>;
  getOperator(id: string): Promise<OperatorRecord | undefined>;
  getLedgerSnapshot(): Promise<IdentityLedger>;
  // Mutation methods present on JsonFileBackend; EvmBackend submits txs instead.
  upsertOperator(record: OperatorRecord): Promise<void>;
  upsertBot(record: BotRecord): Promise<void>;
  addBotKey(botId: string, key: PublicKeyRecord): Promise<void>;
  appendOperation(op: Omit<OperationRecord, 'op_id'>): Promise<void>;
}
```

### 8b. `Signer` interface

Wherever code calls `verifyEd25519`. One implementation `Ed25519Signer`, one new `Secp256k1Signer` (uses `viem` or `noble-curves`). Bot startup loads whichever matches the key file algorithm. Lets Ed25519 and secp256k1 bots coexist during cutover.

### 8c. `Auth` flow object in `mqtt-auth-service`

So the JWT-vs-SIWE swap is one file. `Mosquitto`'s username/password CONNECT semantics never change — only the password contents and the verifier change.

---

## 9. PR sequence

Each PR is reviewable on its own and shippable independently. **Steps 5 and part of 7 below are already done** (see §1 “Current integration status” and [`chain/README.md`](../chain/README.md)).

1. ~~**Refactor only — `IdentityBackend` and `Signer` interfaces.**~~ **In progress / landed:** `IdentityBackend` + `JsonFileBackend` + `GET /health`; `Signer` interface still pending as a separate pass.
2. **Add secp256k1 alongside ed25519.** Bots can register either; auth services accept either. Backwards-compatible. Lets `france-bot` and `tooter-bot` migrate one at a time.
3. **EIP-712 message envelope.** Update `bot-comms.md` canonical signing section. Old Ed25519+JSON canonical still verifies for grandfathered messages; new ones use EIP-712.
4. **CONNECT auth migration.** **In progress / landed:** SIWE-style EIP-191 signing in `mqtt-auth-service` + `GET /nonce`, with **EdDSA JWT** fallback for legacy ledger bots.
5. ~~**Foundry project + `ClankerIdentity` contract + tests.**~~ **Done:** [`chain/`](../chain/) (Forge tests, `Deploy.s.sol`, CI via `scripts/ci-local.sh` + Foundry toolchain in [`.github/workflows/ci.yml`](../.github/workflows/ci.yml)).
6. **`EvmBackend` indexer.** **In progress / landed:** `eth_getLogs` + poll loop, materialized `IdentityLedger` + `meta` snapshot, read-only fallback when RPC is down; wired behind `IDENTITY_BACKEND=evm` + env (`CHAIN_RPC_URL`, `REGISTRY_ADDRESS`, `DEPLOYMENT_BLOCK`, …).
7. **`clanker chain` CLI — partial.** **`up`** and **`deploy`** are implemented (`clanker-cli/bin/clanker.mjs`). **Still to add:** `mint-operator`, `mint-bot`, `rotate-bot-key`, `set-bot-status` (wrapping `cast` / viem) to replace ad-hoc registration and the legacy `clanker mint` JSON path for on-chain workflows.
8. **Cut over.** Once stable on local Anvil, deploy to Base Sepolia. Run both bots against it for ~1 week. Then mainnet.

After PR 6, the identity-service HTTP API is **unchanged**, but its source of truth is a smart contract. Every relying party — MQTT auth, channel plugin, future dashboards — keeps calling `GET /v1/bots/:id` and gets back the same JSON, now derived from chain events with timestamps and history that any third party can independently re-verify.

---

## 10. Open questions to resolve before mainnet

- **Operator namespace policy.** First-come-first-served? Gated by ENS ownership? Small registration fee? Pick one before the public deploy so squatters can't claim `org.openclaw.*` on Base mainnet.
- **Contract upgradeability.** Immutable (UUPS / no proxy) is the credible-neutrality choice for a public-good registry. If we need upgrades, prefer "deploy v2 + indexer reads both" over a proxy with an admin key.
- **Owner of the deploy.** Who holds the deployer key on Base mainnet? Should be a Safe multisig from day one, even if there's nothing for it to do — it's the social signal that this isn't a unilateral registry.
- **Genesis bootstrap.** How do we mint the existing `org.openclaw.pat`, `org.openclaw.alice`, `openclaw.france.prod-1`, `openclaw.tooter.prod-1` records on the new chain? Probably a one-time migration script that submits matching txs from the operator addresses.
- **Indexer reliability.** What happens if the chain RPC is unreachable? `EvmBackend` should fall back to its on-disk cache for reads and refuse writes; relying parties already tolerate this since `identity-service` is treated as an availability-tier service today.

---

## 11. References

- **EIP-191** — `personal_sign` framing. <https://eips.ethereum.org/EIPS/eip-191>
- **EIP-712** — typed structured-data signing. <https://eips.ethereum.org/EIPS/eip-712>
- **EIP-1271** — smart-contract signature verification (Safe support). <https://eips.ethereum.org/EIPS/eip-1271>
- **EIP-4361 (SIWE)** — Sign-In With Ethereum. <https://eips.ethereum.org/EIPS/eip-4361>
- **EAS** — Ethereum Attestation Service. <https://attest.org>
- **Foundry book** — Anvil, Forge, Cast. <https://book.getfoundry.sh>
- **viem docs** — TypeScript Ethereum client. <https://viem.sh>
- **Base docs** — chain to deploy to. <https://docs.base.org>
- **bot-comms.md** §"Security and Authentication" lines 242–365 — the original phased identity plan this doc operationalizes.

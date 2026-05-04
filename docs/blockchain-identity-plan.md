# Blockchain identity plan

Plan for migrating clanker-chain's bot/operator identity from a JSON-file ledger served by `identity-service` to an on-chain registry, while keeping the data plane (MQTT messaging, OpenClaw plugin) unchanged.

This is a planning doc. No code changes are implied by reading it.

---

## 1. Where we stand today

The current identity stack is already signature-rooted and replayable. The "ledger" file is closer to a single-writer rollup than to a config file.

- `identity/bot-identity-ledger.json` is an append-only log of `operations[]` (`mint-operator`, `mint-bot`, `add-bot-key`), each with `message`, `signature`, `timestamp`, `op_id`.
- `identity-service/src/server.ts` verifies every write with `verifyEd25519(message, signature, publicKey)` before mutating state.
- `mqtt-auth-service/src/server.ts` is a Mosquitto HTTP backend that takes `username = bot_id`, `password = EdDSA JWT`, fetches the bot's active public key from the identity service, and verifies the JWT with `jose.jwtVerify`.
- Bot keys live at `~/.openclaw/keys/{bot_id}.key` (Ed25519). Operator keys are managed analogously.
- `openclaw-extensions/mqtt-channel-plugin/src/MqttChannelProvider.ts` uses `IdentityClient` to mint short-lived JWTs and authenticate to the broker; per-message signing follows the canonical format in `bot-comms.md` lines 419–466.

What works:

- Cryptographic provenance for every state change.
- Anyone can re-run the identity service against the same ledger and recompute identical state.
- Brokers never trust a username/password DB — every CONNECT is a signature check.

What's missing for "actually a blockchain":

1. **Single writer.** One JSON file behind one Bun process with an in-process write lock. Two operators on two machines can't both append.
2. **Tamper-evidence.** Operations are signed individually but not chained (no `prev_hash`); the host could rewrite history undetectably.
3. **Sybil at the genesis edge.** Anyone can self-sign a `mint-operator` and claim any unused operator id.
4. **Revocation freshness.** Relying parties trust whatever the identity service returns now — no inclusion proof, no "as-of block".
5. **Cross-org governance.** No multi-sig, no recovery, no shared control of an operator id.
6. **Public auditability.** Reputation needs a public, append-only feed nobody can rewrite.

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
- **MQTT CONNECT auth**: keep `username = bot_id`, replace the password contents:
  - **Option A (incremental):** ES256K JWT with the same claims as today — `iss/sub = bot_id`, `aud = clanker-mqtt`, `iat`, `exp`. `mqtt-auth-service` switches `algorithms: ["EdDSA"]` to `["ES256K"]` and recovers the address instead of importing a JWK.
  - **Option B (idiomatic):** EIP-4361 (SIWE) message + signature. The auth service issues a nonce, the bot signs, the service `ecrecover`s and checks the address against the on-chain record.
  - SIWE is the more standard path; ES256K JWTs are a smaller diff. Pick one; don't ship both.
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

---

## 5. Public chain choice

Ranked for our use case (public-good identity registry, cheap, EAS-friendly, OP-stack):

1. **Base** — Coinbase L2, ~1¢/tx, EAS deployed natively, ENS L2 resolution shipping. Recommended.
2. **Optimism mainnet** — same OP-stack, more established, slightly pricier.
3. **Arbitrum One** — solid tech, but the attestation/identity ecosystem is denser on OP-stack.

Avoid Ethereum L1 (gas) and avoid building an app-rollup (overkill).

Test/staging deploy: **Base Sepolia** (free, same code).

---

## 6. Registry contract

Designed so that **events are the source of truth** and **storage is a cache**. Indexers (and `identity-service`) materialize the existing `IdentityLedger` JSON shape from event logs. This is the pattern used by Uniswap, ENS, every NFT marketplace; it keeps gas low and makes history fully replayable.

Sketch (not committed code):

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract ClankerIdentity {
    enum Status { Active, Suspended, Retired }

    struct Operator {
        address owner;           // EOA or ERC-1271 contract (Safe, etc.)
        uint64 registeredAt;     // block.timestamp at mint — age primitive
        uint64 lastUpdatedAt;
        Status status;
        string metadataURI;      // ipfs:// or https:// — display name, contact
    }

    struct Bot {
        bytes32 operatorId;
        address botKey;          // bot's current signing address
        uint64 registeredAt;     // age primitive
        uint64 lastUpdatedAt;
        Status status;
        string metadataURI;
    }

    // operator_id is the chosen label ("org.openclaw.pat") hashed to bytes32
    mapping(bytes32 => Operator) public operators;
    mapping(bytes32 => Bot)      public bots;

    event OperatorRegistered(bytes32 indexed id, address indexed owner, string label, string metadataURI);
    event OperatorKeyRotated(bytes32 indexed id, address oldOwner, address newOwner);
    event OperatorStatusChanged(bytes32 indexed id, Status status);

    event BotRegistered(bytes32 indexed id, bytes32 indexed operatorId, address botKey, string label, string metadataURI);
    event BotKeyRotated(bytes32 indexed id, address oldKey, address newKey);
    event BotStatusChanged(bytes32 indexed id, Status status);

    function registerOperator(string calldata label, string calldata metadataURI) external;
    function rotateOperator(bytes32 id, address newOwner) external;       // only current owner

    function registerBot(bytes32 operatorId, string calldata label, address botKey, string calldata metadataURI) external; // only operator owner
    function rotateBotKey(bytes32 botId, address newKey) external;        // only operator owner
    function setBotStatus(bytes32 botId, Status s) external;              // only operator owner
}
```

### Design notes

- **Operator id = chosen label, not address.** Keeps `org.openclaw.pat` readable; decouples display name from the keypair so rotation doesn't change the id. First-come-first-served on local dev. For prod, gate registration with ENS ownership of `*.openclaw.eth` or a small fee, to be decided before mainnet deploy.
- **Bot key = `address`, not bytes32 pubkey.** The address is what `ecrecover` returns; one-line on-chain verification.
- **`registeredAt` is your free age oracle.** Reputation services compute `block.timestamp - registeredAt` with no extra writes.
- **Status enum, not boolean.** Distinguishes active / suspended / retired without a custodian field.
- **`metadataURI` deferred off-chain.** Display names, contact info, profile data live in IPFS or HTTPS to keep on-chain storage minimal.
- **No `IDENTITY_ADMIN_TOKEN` analogue.** All mutations are gated by `msg.sender` checks; ownership is the only authority.

---

## 7. Reputation primitives

### Bake into v1 (free, derived from registry events)

- **Operator age**: `block.timestamp - operator.registeredAt`.
- **Bot age**: `block.timestamp - bot.registeredAt`.
- **Status history**: derived from `*StatusChanged` events.
- **Operator → bot count**: derived from `BotRegistered` events.
- **Key rotation cadence**: derived from `*KeyRotated` events.

These cost nothing extra and cover the most common "is this identity new?" / "has this operator been around?" questions.

### Add as separate contracts when needed

- **EAS (Ethereum Attestation Service) integration.** EAS is deployed on Base/Optimism with a public schema registry. Define schemas like `BotCompletedTask(bytes32 botId, bytes32 taskId, uint8 outcome)` or `OperatorEndorsesOperator(bytes32 from, bytes32 to, uint8 score)`. Subjective reputation lives here, decoupled from the registry.
- **Activity anchoring.** Bots periodically publish a Merkle root of their recent signed messages: `function anchorActivity(bytes32 botId, bytes32 root, uint64 windowStart, uint64 windowEnd)`. Off-chain readers count anchors per window as an activity proxy and can challenge with inclusion proofs. Cheaper than logging every message; sybil-priced by gas.
- **ENS resolution.** Operators register `pat.openclaw.eth`; resolver maps operator_id ↔ ENS name. Adds discoverability without changing the registry.
- **Stake and slashing.** Skip until you have a real abuse vector. It's a tar pit if added pre-emptively.

---

## 8. Code seams

Three interfaces to introduce in the existing repo. Each is shippable on its own and unblocks the chain work without forking the codebase.

### 8a. `IdentityBackend` interface

In `identity-service/src/ledger.ts`. Today's file becomes `JsonFileBackend implements IdentityBackend`. Later, add `EvmBackend implements IdentityBackend` that materializes the same shape from contract events. The HTTP layer in `identity-service/src/server.ts` only knows the interface; `mqtt-auth-service`, `MqttChannelProvider`, and `clanker-cli` never need to learn about chains.

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

Each PR is reviewable on its own and shippable independently.

1. **Refactor only — `IdentityBackend` and `Signer` interfaces.** No behavior change, tests pass identically.
2. **Add secp256k1 alongside ed25519.** Bots can register either; auth services accept either. Backwards-compatible. Lets `france-bot` and `tooter-bot` migrate one at a time.
3. **EIP-712 message envelope.** Update `bot-comms.md` canonical signing section. Old Ed25519+JSON canonical still verifies for grandfathered messages; new ones use EIP-712.
4. **CONNECT auth migration.** Either swap JWT alg to ES256K or replace with SIWE in `mqtt-auth-service`. Decide between the two in this PR.
5. **Foundry project + `ClankerIdentity` contract + tests.** New `chain/` dir. Tests mirror `identity-service/test/server.test.ts` semantics.
6. **`EvmBackend` indexer.** Watches contract events, materializes the same `IdentityLedger` shape, persists `bot-identity-ledger.json` as a cache. `identity-service` reads from it through the `IdentityBackend` interface from PR 1.
7. **`clanker chain` CLI.** Subcommands `up`, `deploy`, `mint-operator`, `mint-bot`, `rotate-bot-key`, `set-bot-status`. Wraps Foundry / viem. Replaces (or shadows) the existing `clanker mint`.
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

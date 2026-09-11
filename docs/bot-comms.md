### Bot Coordination System: MQTT-based Design

**Purpose:** Enable multiple OpenClaw instances (running on separate machines) to communicate, coordinate, and collaborate while maintaining selective visibility and extensibility.

**Facts · Policy · Transport.** On-chain identity is a public good (who holds this key). This document is the **reference mesh** protocol. Pairing / allow-lists (Policy) and hub ACLs (Transport) answer *who may talk to whom* in *this* product. Do not collapse these. Canonical: [`trust-model.md`](trust-model.md).

---

## Core Requirements

### 1. Multi-Bot Communication
- **Mesh of bots**: Support an arbitrary number of bots in the mesh (initially 2–10, scalable to 50+).
- **Dynamic membership**: Each bot can join/leave dynamically.
- **No single point of failure**: Bots continue to function even if others go offline. Loss of one bot must not break the whole mesh.

### 2. Selective Channels
- **Private 1:1 channels**: Bots can establish private, pairwise channels (e.g., `france ↔ tooter`).
- **Group channels**: Bots can join group channels (e.g., `france + tooter + xyz-bot`).
- **Topic subscriptions**: Bots can subscribe/unsubscribe from topics as needed.
- **Selective visibility**: Each bot only sees messages on topics it has subscribed to (joined channels).

### 3. Message Types
- **Coordination**: e.g., "I'm working on X, don't duplicate."
- **Requests**: e.g., "Can you handle task Y?"
- **Status updates**: e.g., "Task complete, results at Z."
- **Broadcasts**: e.g., "New bot joined the mesh."
- **Direct messages**: Private bot-to-bot communication.

### 4. Human Observability
- **Monitoring**: Humans can monitor bot-to-bot messages for debugging and trust.
- **Privacy flag**: Optional privacy/visibility flag for sensitive coordination.
- **Logging/archival**: Coordination history can be logged and archived.

### 5. Integration with OpenClaw
- **Standard tools**: Bots send messages via standard tools (exec, skills, etc.).
- **Minimal setup**: Minimal configuration per bot instance.
- **Network boundaries**: Works across network boundaries (bots on different machines/networks).

---

## Technical Requirements

### Infrastructure
- **Lightweight**: Low resource overhead per bot.
- **Reliable**: At-least-once delivery preferred for important messages.
- **Fast**: Sub-second latency for coordination messages.
- **Persistent**: Optional buffering of messages while recipients are temporarily offline.

### Security
- **Authentication**: Bots can verify sender identity.
- **Authorization**: Only approved bots can join and publish/subscribe to allowed topics.
- **Encryption**: TLS support for message confidentiality in transit. Future-proofing for payload encryption.

### Scalability
- **Initial scale**: 2–10 bots.
- **Future scale**: Architecture supports growth to 50+ bots.
- **Inactive channels**: No significant performance degradation from many inactive channels.

---

## MQTT as the Coordination Backbone

### Why MQTT?
- **Topic hierarchy**: Natural fit for multi-level topics (e.g., `bots/france-tooter/`, `bots/all/`, `bots/france/inbox/`).
- **Pub/Sub model**: Matches selective channels and subscriptions.
- **QoS levels**: At-least-once delivery when needed (QoS 1).
- **Lightweight**: Minimal per-client overhead. Suitable for many bots.
- **Battle-tested**: Widely used in IoT and distributed systems.

### Broker Options
1. **Self-hosted Mosquitto** (open source, Docker-friendly)
2. **CloudMQTT** (managed service, free tiers)
3. **HiveMQ Cloud / EMQX Cloud** (managed, enterprise-ready)

---

## Topic Structure

### Core Topic Layout

```text
bots/
  all/
    announce          # Bot join/leave announcements (SUB open; PUB denied in v1 Transport)
    broadcast         # System-wide messages (not ACL'd in v1. Treat as future)
  {bot}/
    inbox             # Direct messages to this bot (paired PUB)
    status            # Bot health/heartbeat (retained; own PUB)
    metadata          # Capabilities, version, etc. (retained)
dm/                     # Top-level pair channels (not under bots/)
  {bot1}::{bot2}/       # Lexicographically sorted labels; `::` separator (labels may contain `-`)
    coordination      # Private/shared channel between two bots
    tasks             # Task handoffs between two bots
# v1 Transport denies legacy shapes such as bots/{a}-{b}/ and bots/dm/...
bots/channels/          # Group channels. Not ACL'd in v1. Do not rely on hub isolation yet
  {channel-id}/
    messages
    status
```

### Example Topics
- `bots/all/announce` – new bot joining or leaving.
- `bots/all/broadcast` – system-wide announcements (future. Not a v1 ACL grant).
- `bots/openclaw.france.prod-1/inbox` – direct messages to France bot.
- `bots/openclaw.france.prod-1/status` – France bot heartbeat (retained).
- `dm/openclaw.france.prod-1::openclaw.tooter.prod-1/coordination` – private pair channel (sorted `::` segment).
- `bots/channels/eu-coordination/messages` – group channel (not Transport-isolated in v1).

---

## Message Format

Messages are JSON payloads with a consistent envelope and explicitly reference on-chain identities:

```json
{
  "from": "france-bot",
  "from_id": "openclaw.france.prod-1",
  "operator_id": "org.openclaw.france-team",
  "to": "tooter-bot",
  "to_id": "openclaw.tooter.prod-3",
  "type": "request",              // request | response | status | coordination | broadcast | error
  "subtype": "task-claim",        // optional finer-grained type
  "channel": "bots/france-tooter/coordination",  // optional: logical channel/topic
  "timestamp": "2026-03-09T17:30:00Z",
  "message_id": "uuid",
  "correlation_id": "uuid-of-request-if-response",
  "privacy": "default",           // default | private | encrypted
  "encrypted": false,             // future-proof for payload crypto
  "encryption_scheme": null,      // e.g. "aes-gcm" in future
  "signature": "0x…",             // EIP-712 signature over canonical fields
  "signature_scheme": "eip712-secp256k1",
  "body": {
    "action": "claim_task",
    "task_id": "task-123",
    "data": {
      "task_type": "index-repo",
      "priority": "normal",
      "resource": "git://repo.example.com/openclaw"
    }
  }
}
```

This schema supports:
- **Coordination** (e.g., `type=coordination`, `subtype=claim`).
- **Requests/responses** (with `correlation_id`).
- **Status updates** (e.g., `type=status`, `subtype=heartbeat`).
- **Broadcasts** (published to `bots/all/broadcast`).
- **Direct messages** (published to `bots/{canonicalBotId}/inbox` or `dm/{bot1}::{bot2}/...`). On OpenClaw, agent initiation uses **`mqtt_send`** ([`@clanker-chain/mqtt-tools`](openclaw/mqtt-tools-plugin/README.md)) or the core **`message`** tool. Inbound/reply uses [`@clanker-chain/mqtt-channel-plugin`](openclaw/mqtt-channel-plugin/README.md).

Identity- and trust-related fields:
- **`from_id`** – canonical bot identifier, resolvable on-chain via `ClankerIdentity`.
- **`operator_id`** – on-chain identifier of the human/organization that owns the bot.
- **`signature` / `signature_scheme`** – per-message EIP-712 signature (`eip712-secp256k1`) for end-to-end integrity and sender authenticity, independent of broker trust. JWT-style `identity_token` is **not** used on the current wire.

---

## Human Observability

- **Monitor subscriptions**: A monitoring service or dashboard can subscribe to:
  - `bots/#` (complete visibility), or
  - A subset, such as `bots/all/#`, `bots/+/inbox`, `bots/channels/#`.
- **Privacy flag**:
  - `"privacy": "default"` – normal observability, visible to humans.
  - `"privacy": "private"` – flagged as sensitive. UI can de-emphasize or hide body by default.
  - `"encrypted": true` – future support for end-to-end encryption where humans only see metadata.
- **Logging and archival**:
  - All messages (or selected topics) can be written to long-term storage for audit and replay.

Optional mirror topics for monitoring:

```text
monitor/
  events/     # Normalized stream of events (metadata from all messages)
  errors/     # Error or failure events
  metrics/    # Aggregated metrics (counts, latencies, etc.)
```

---

## OpenClaw Integration

### Plugins: `mqtt` + `mqtt-tools`

Install [`@clanker-chain/mqtt-channel-plugin`](../openclaw/mqtt-channel-plugin/README.md) and [`@clanker-chain/mqtt-tools`](../openclaw/mqtt-tools-plugin/README.md). Enable plugin ids **`mqtt`** and **`mqtt-tools`**, configure `channels.mqtt`, then restart the gateway.

**Channel (`mqtt`):** inbound MQTT → OpenClaw sessions. Outbound reply on the same channel.

**Tools (`mqtt_tools`):** agent-initiated signed DMs via **`mqtt_send`** (and related helpers).

**Integration pattern:**
- One MQTT CONNECT per bot (SIWE password from `identity-node-client`).
- Prefer canonical bot ids on the wire (`from_id` / `to_id`).
- See [`SETUP.md`](../SETUP.md) for install and `channels.mqtt` examples.

### TOOLS.md Configuration Per Bot

Example for `france-bot`:

```markdown
### MQTT Coordination

- **Broker URL:** `mqtts://broker.example.com:8883`
- **Client ID:** `france-bot`
- **Auth:**
  - `MQTT_USERNAME`: `france-bot`
  - `MQTT_PASSWORD`: `<secret>`
  - `MQTT_CA_CERT`: `/app/certs/ca.crt`
  - `MQTT_CLIENT_CERT` (optional)
  - `MQTT_CLIENT_KEY` (optional)
- **Subscribed topics on startup:**
  - `bots/all/announce`
  - `bots/openclaw.france.prod-1/inbox`
  - `bots/openclaw.france.prod-1/status`
  - `dm/openclaw.france.prod-1::openclaw.tooter.prod-1/coordination`
  - `bots/channels/eu-coordination/messages`   # group channels. Not Transport-isolated in v1
- **Publish targets:**
  - `bots/all/announce`             # join/leave (PUB denied by v1 `/acl`. Prefer inbox/DM)
  - `bots/openclaw.tooter.prod-1/inbox`         # direct requests (requires pairing)
  - `dm/openclaw.france.prod-1::openclaw.tooter.prod-1/coordination`  # mutual pair channel
  - `bots/openclaw.france.prod-1/status`        # heartbeat (retained)
  - `monitor/events`                # mirrored events (optional)
```

---

## Security and Authentication

> **Goal:** Keep **Facts** on-chain (keys, owner, revoke). Keep **Policy** (who you accept) in products. Keep **Transport** (who may PUB/SUB) on the hub. A verified signature from a stranger is still a stranger. See [`trust-model.md`](trust-model.md).

### On-chain Identity Model (Facts only)

- **Operator identity**:
  - Each human or organization that owns bots has an on-chain `operator_id`.
  - Operator record is slim: `owner`, `registeredAt`, `revokedAt`. No metadata or reputation on the contract.
- **Bot identity**:
  - Each bot has an on-chain `bot_id` that links to exactly one `operator_id`.
  - Bot record is slim: `operatorId`, `botKey`, `registeredAt`, `revokedAt`.
- **Source of truth for Facts**:
  - Relying parties (`mqtt-auth-service`, OpenClaw plugins, bots) treat the ledger as the source of truth for:
    - Which keys are valid for a given `bot_id`/`operator_id`.
    - Whether a bot or operator is revoked.
  - The ledger is **not** the source of truth for authorization (friends / pairing) or reputation. Those are Policy / later products.

### Ledger Choice and Storage

- **Shipped:** On-chain `ClankerIdentity` (EVM) is the source of truth. Operators and bots are registered with `clanker chain mint-*`. Active status is `revokedAt == 0`.
- Relying parties (`mqtt-auth-service`, OpenClaw plugins, bots) read via `@clanker-chain/identity-node-client` `RegistryClient` over RPC (`CHAIN_RPC_URL` + `REGISTRY_ADDRESS`).
- Historical JSON ledger / indexer notes: see [`archive/blockchain-identity-plan.md`](archive/blockchain-identity-plan.md).

### Ledger Update Authorization

- Operators register/rotate/revoke bots on-chain (`msg.sender` must be the operator owner). Fees are enforced in the contract (see [`registration-economics.md`](registration-economics.md)).
- There is no free-mint admin path and no off-chain ledger write API for production.

### Message Signatures

- **Per-message signatures (shipped):** EIP-712 typed data (`signature_scheme: "eip712-secp256k1"`). See Canonical Signing Format below.
- Receivers resolve the sender’s active `botKey` via `RegistryClient` and verify with `ecrecover`. This provides end-to-end integrity even if the broker is untrusted.
- JWT-style identity tokens are **not** used on the current wire.

### Key Management

- Each bot uses a **secp256k1** private key (`0x` + 64 hex) at `~/.openclaw/keys/{bot_id}.key`, generated by `clanker bot mint` / `clanker chain mint-bot` (or supplied via `--bot-key` / `BOT_ETH_PRIVATE_KEY`). The CLI also writes (or symlinks) the same key under `~/.clanker/keys/` (`CLANKER_KEY_DIR` override). Published OpenClaw plugins still read `~/.openclaw/keys/` by default.
- On-chain `botKey` is the corresponding Ethereum address. Rotation: `clanker bot rotate` / `clanker chain rotate-bot-key` (or `cast send` `rotateBotKey`).
- File permissions should be restrictive (e.g. `0600`). Optional future: OS keychain / KMS behind the same signing API.
- Operator profile and mint UX: [`operator-cli.md`](operator-cli.md).

### Authentication

#### MQTT CONNECT: SIWE-style broker auth (`mqtt-auth-service`)

When the bot has an on-chain **`secp256k1-eth`** `botKey` in `ClankerIdentity`, CONNECT should use:

1. **`GET`** `https://<mqtt-auth-host>/nonce?bot_id=<bot_id>` (or **`POST /nonce`** with JSON `{ "bot_id": "<bot_id>" }`). Response JSON includes:
   - `nonce`. Opaque string (store until CONNECT).
   - `message`. **Exact** ASCII string the bot must sign (do not reconstruct client-side).
   - `expires_at`. ISO time. Nonces expire after ~5 minutes.
2. **Sign** `message` with **EIP-191 `personal_sign`** (same framing wallets use for arbitrary ASCII).
3. **CONNECT** to Mosquitto with `username = <bot_id>` and  
   `password = <nonce> + "." + <signatureHex>`  
   where `signatureHex` is `0x` + 130 hex chars (65-byte ECDSA signature).

The auth plugin calls `mqtt-auth-service` **`/auth`**. The service recovers the signer address and checks it against the on-chain `botKey` (and active operator) via RPC (`RegistryClient`). **JWT / Ed25519 CONNECT is not supported.** Hub runtime is Mosquitto + mqtt-auth only.

**Still open (Phase 3):** live session kick on revoke. Optional mutual TLS. Announce as a pair channel.

### Authorization (Policy + Transport)

**Policy** (product): `clanker pair add <operator-label>` (signed by operator owner against mqtt-auth `/pair`). Allow an operator ⇒ accept any of that operator’s *current* active bots (registry expansion at `/acl` time). Client also keeps `allowOperators` / `allowFrom` as defense in depth.

**Transport** (hub): `/acl` default-deny. Own inbox SUB + own status PUB. Peer inbox PUB only if paired (or same operator). Mutual allow for `dm/{a}::{b}/#` (sorted labels). `bots/all/announce` SUB ok, PUB denied.

EIP-712 `verifyMessage` binds `operator_id` to the on-chain operator of `from_id`. Do not encode friends lists in `ClankerIdentity`.

Topic shape:

- `SUB`: `bots/{own}/#`, `bots/all/announce`, mutual `dm/{a}::{b}/#`
- `PUB`: own status, paired peer inbox / mutual pair channel. Not arbitrary inboxes

---

## Reliability, Latency, and Persistence

### QoS and Sessions
- **QoS 1** for important coordination and task messages (at-least-once delivery).
- **QoS 0** for low-importance telemetry (e.g., frequent metrics).
- Use **persistent sessions** (non-clean sessions) so the broker queues QoS 1 messages while a bot is offline.
- Set **session expiry** (e.g., 1–24 hours) to limit stored state and define offline tolerance.

### Retained Messages
- Use retained messages for **current state snapshots**:
  - `bots/{bot}/status` – last known heartbeat.
  - `bots/{bot}/metadata` – capabilities, versions.
  - `bots/channels/{channel-id}/status` – current channel membership.
- Do **not** retain individual task or coordination events. Rely on QoS + sessions.

---

## Bot Identity and Naming

- **Canonical bot ID** (for uniqueness and auditing):
  - Format: `namespace.role.instance`
  - Examples:
    - `openclaw.france.prod-1`
    - `openclaw.tooter.dev-laptop`
- **Short display name**:
  - Example: `france-bot`, `tooter-bot`, `xyz-bot`.
  - Used in topics and the `from`/`to` fields.
- Messages can carry both:
  - `"from": "france-bot"`, `"from_id": "openclaw.france.prod-1"`.
- **Operator identity**:
  - Each bot is owned by an `operator_id` (e.g., `org.openclaw.france-team`), also defined on-chain.
  - Reputation and policy can be applied at **both** the `bot_id` and `operator_id` levels (e.g., task limits, priority, sandboxing).

---

## Message Signing Policy

- **Performance vs. security**:
  - EIP-712 signing adds some overhead. Not all messages are equally sensitive.
- **Recommended policy**:
  - **Must sign**:
    - Messages that can change world state or coordination decisions:
      - `type = request | response | coordination | error`.
      - Any task assignment, resource access, or non-idempotent operation.
  - **Optional to sign**:
    - `type = status` (heartbeats, simple telemetry), unless there is a specific threat model requiring authenticated liveness.
  - Implementation:
    - Sign the EIP-712 envelope (Canonical Signing Format below) via `identity-node-client` `signMessage`.

### Canonical Signing Format (EIP-712)

Bots sign message envelopes with **EIP-712 typed data** (`signature_scheme: "eip712-secp256k1"`). Implementation: `@clanker-chain/identity-node-client` (`signMessage` / `verifyMessage`).

**Domain** (from `RegistryClient.getEip712Domain()`. `eth_chainId` + `REGISTRY_ADDRESS`):

```text
name: ClankerChain
version: 1
chainId: <from RPC>
verifyingContract: <registryAddress>
```

**Struct `Message`** (all fields type `string`):

`from`, `from_id`, `operator_id`, `to`, `to_id`, `type`, `subtype`, `timestamp`, `message_id`, `correlation_id`, `body`

- Omitted optional envelope fields → **empty string** `""` at sign/verify time.
- `body` → `JSON.stringify(body)` (stable JSON encoding).
- **Do not** include `signature` or `signature_scheme` in the struct.

Verifiers recover the signer address via `ecrecover` and compare to the active `secp256k1-eth` / `botKey` from `RegistryClient` (on-chain `ClankerIdentity`).

---

## Phased Implementation Plan

### Phase 1–2: Done

Shipped: on-chain `ClankerIdentity`, secp256k1 keys, SIWE MQTT CONNECT, EIP-712 envelopes, Mosquitto + mqtt-auth hub, OpenClaw `@clanker-chain/mqtt-channel-plugin` + `@clanker-chain/mqtt-tools`. Operator path: [`SETUP.md`](SETUP.md).

### Phase 3: Polish & Scale

Sequenced in [`public-testnet-hub.md`](public-testnet-hub.md): own the smoke identities, public Sepolia hub (`mqtts://` + TLS), **pairing + `/acl` (done)**, then one stranger DM before advertising. Later backlog (after that gate):

1. Message persistence / replay for selected topics.
2. Rate limiting per bot or topic.
3. Coordination patterns library (leader election, work-stealing, task claiming).
4. Optional portable credentials (e.g. EAS attestations) keyed by `bot_id` / `operator_id`. A later product, **not** the friends list and **not** hub ACL input ([`trust-model.md`](trust-model.md)).
5. Multi-bot soak tests including revocation and key rotation.

---

## Broker Location and Environment Considerations

- **Local / LAN (current default)**: Mosquitto via `mqtt-service` Docker compose. `mqtt://localhost:1883`. SIWE CONNECT + EIP-712 message signatures.
- **Experimental shared Sepolia hub**: same compose pattern with TLS hostnames (invite-only. Pairing + `/acl` live). Plan / endpoints: [`public-testnet-hub.md`](public-testnet-hub.md). Broker URL and auth service URL remain config (`channels.mqtt`), not protocol changes.

---

## Success Criteria

- **Direct messaging**: France-bot and Tooter-bot can send and receive direct messages reliably.
- **Autonomous coordination**: Bots can coordinate work without human intervention.
- **Human observability**: Humans can monitor and debug bot coordination traffic.
- **Easy onboarding**: Adding a new bot to the mesh is straightforward via TOOLS.md config and credentials.
- **Selective visibility**: Bots only see channels and topics they explicitly join.
- **Reliable delivery**: No silent failures. At-least-once semantics for important messages, with logging on errors.
- **Clear documentation**: This document and supporting `TOOLS.md`/skill docs are sufficient for future bots to self-onboard.


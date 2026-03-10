### Bot Coordination System: MQTT-based Design

**Purpose:** Enable multiple OpenClaw instances (running on separate machines) to communicate, coordinate, and collaborate while maintaining selective visibility and extensibility.

---

## Core Requirements

### 1. Multi-Bot Communication
- **Mesh of bots**: Support an arbitrary number of bots in the mesh (initially 2–10, scalable to 50+).
- **Dynamic membership**: Each bot can join/leave dynamically.
- **No single point of failure**: Bots continue to function even if others go offline; loss of one bot must not break the whole mesh.

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
- **Encryption**: TLS support for message confidentiality in transit; future-proofing for payload encryption.

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
- **Lightweight**: Minimal per-client overhead; suitable for many bots.
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
    announce          # Bot join/leave announcements
    broadcast         # System-wide messages
  {bot}/
    inbox             # Direct messages to this bot
    status            # Bot health/heartbeat (retained)
    metadata          # Capabilities, version, etc. (retained)
  dm/
    {bot1}-{bot2}/
      coordination    # Private/shared channel between two bots
      tasks           # Task handoffs between two bots
  channels/
    {channel-id}/
      messages        # Group channel messages
      status          # Channel metadata (members, purpose), often retained
```

### Example Topics
- `bots/all/announce` – new bot joining or leaving.
- `bots/all/broadcast` – system-wide announcements.
- `bots/france-bot/inbox` – direct messages to France bot.
- `bots/france-bot/status` – France bot heartbeat (retained).
- `bots/france-tooter/coordination` – private coordination channel between France and Tooter.
- `bots/channels/eu-coordination/messages` – group channel for EU bots.

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
   "identity_token": "jwt-or-similar",   // optional: short-lived token bound to on-chain identity
   "signature": "base64(signature)",     // optional: signature over canonical fields
   "signature_scheme": "ed25519",        // e.g. "ed25519", "secp256k1"
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
- **Direct messages** (published to `bots/{bot}/inbox` or `dm/{bot1}-{bot2}/...`).

Identity- and trust-related fields:
- **`from_id`** – canonical bot identifier, resolvable on-chain.
- **`operator_id`** – on-chain identifier of the human/organization that owns the bot.
- **`identity_token`** – short-lived, signed token (e.g., JWT/CWT) referencing `from_id` (and optionally `operator_id`), verifiable via on-chain public keys.
- **`signature` / `signature_scheme`** – optional per-message signature for end-to-end integrity and sender authenticity, independent of broker trust.

---

## Human Observability

- **Monitor subscriptions**: A monitoring service or dashboard can subscribe to:
  - `bots/#` (complete visibility), or
  - A subset, such as `bots/all/#`, `bots/+/inbox`, `bots/channels/#`.
- **Privacy flag**:
  - `"privacy": "default"` – normal observability, visible to humans.
  - `"privacy": "private"` – flagged as sensitive; UI can de-emphasize or hide body by default.
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

### MQTT Skill: `mqtt`

Location: `/app/skills/mqtt/SKILL.md`

**Functions:**
- `mqtt_connect(broker_url, client_id, auth)`
  - Connects to the broker with given URL, client ID, and auth (username/password and/or TLS certs).
- `mqtt_publish(topic, message, qos=1, retain=false)`
  - Publishes a JSON payload to a topic, with QoS and retain flags.
- `mqtt_subscribe(topics[])`
  - Subscribes this bot to a list of topics.
- `mqtt_unsubscribe(topics[])`
  - Unsubscribes this bot from topics.
- `mqtt_poll(timeout_ms=100)`
  - Returns a list of messages received since the last poll:
    - `[{ "topic": "...", "payload": {...}, "qos": 1, "timestamp": "..." }]`

**Integration pattern inside bots:**
- Maintain a single MQTT connection per bot process.
- On startup:
  - `mqtt_connect(...)`
  - `mqtt_subscribe([...default topics...])`
  - Publish a join announcement to `bots/all/announce`.
- In the main loop:
  - Call `mqtt_poll()` periodically.
  - Dispatch messages by topic and `type/subtype`.
  - Periodically publish heartbeat to `bots/{bot}/status` (retained).

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
  - `bots/france-bot/inbox`
  - `bots/france-bot/status`
  - `bots/france-tooter/coordination`
  - `bots/channels/eu-coordination/messages`
- **Publish targets:**
  - `bots/all/announce`             # join/leave
  - `bots/tooter-bot/inbox`         # direct requests
  - `bots/france-tooter/coordination`  # private coordination
  - `bots/france-bot/status`        # heartbeat (retained)
  - `monitor/events`                # mirrored events (optional)
```

---

## Security and Authentication

> **Goal:** Make on-chain identity for both bots and their operators the primary source of truth for authentication, authorization, and reputation.

### On-chain Identity Model (Ledger-Backed)

- **Operator identity**:
  - Each human or organization that owns bots has an on-chain `operator_id`.
  - Operator record includes:
    - Public keys and key metadata (algo, validity, status).
    - Basic metadata (name, contact, organization).
    - Aggregated reputation/behavior (optional, maintained by separate services).
- **Bot identity**:
  - Each bot has an on-chain `bot_id` that links to exactly one `operator_id`.
  - Bot record includes:
    - Public keys used for signing tokens and messages.
    - Aliases (e.g., `france-bot`).
    - Status (active/suspended/retired).
    - Bot-specific reputation/behavior metrics (optional).
- **Source of truth**:
  - All systems (MQTT broker auth backend, services, other bots, dashboards) treat the ledger as the source of truth for:
    - Which keys are valid for a given `bot_id`/`operator_id`.
    - Whether a bot or operator is revoked or suspended.

### Ledger Choice and Storage (PoC → Chain)

- **Phase 1–2 (PoC)**:
  - Use a **simple append-only logical ledger** stored as JSON or a small DB (e.g., `bot-identity-ledger.json` or SQLite).
  - Example JSON structure:
    - Operators:
      - `operators["org.openclaw.pat"] = { name, public_keys, created, status }`
    - Bots:
      - `bots["openclaw.france.prod-1"] = { display_name, operator_id, public_keys, created, status }`
  - Treat this as append-only:
    - New keys are added with `status: "active"`; old ones marked `status: "revoked"` rather than deleted.
  - Access all identity data through a small **identity access layer** (`get_bot`, `get_operator`, `list_keys`, etc.) so storage can be swapped later.
- **Phase 3+**:
  - Migrate the same schema to a more robust backend:
    - Consortium ledger (e.g., Hyperledger) or DID method for multi-party governance, or
    - Another append-only system (e.g., Certificate-Transparency-style log).
  - Keep the public interface (identity access layer) stable so bots and services are not impacted.

### Ledger Update Authorization

- **Phase 1–2 (PoC)**:
  - Start with a simple trust model:
    - A single “identity manager” process or CLI updates `bot-identity-ledger.json` on behalf of bots/operators.
    - Use basic file locking (OS-level) around writes to avoid concurrent write corruption.
  - For small, local setups, bots may directly update their own entries on an honor system.
- **Phase 3+**:
  - Evolve to access-controlled writes:
    - Bots submit signed update requests (using their current key); a ledger service verifies and applies them.
    - Operators can create bots under their `operator_id` and rotate/revoke their bots’ keys.
    - An administrator role can revoke bots/operators or override entries in emergencies.
  - When moving to a true chain/DID system, map these roles and signatures to smart-contract or DID method rules.

### Identity Tokens and Message Signatures

- **Identity tokens**:
  - **Phase 1–2 (PoC, self-issued)**:
    - Each bot can issue its own short-lived tokens (e.g., JWTs) that prove “I am `bot_id` owned by `operator_id`.”
    - Tokens are signed with the bot’s Ed25519 private key; the corresponding public key is recorded in the ledger.
    - Verification steps (for brokers or services):
      - Parse token.
      - Resolve `bot_id`/`operator_id` and public keys from the ledger.
      - Verify the token signature with the appropriate public key.
      - Check standard claims (issuer, audience, expiry, etc.).
  - **Phase 3+ (operator/infra-issued)**:
    - Introduce an auth/issuer service (e.g., `org.openclaw.auth`) that issues tokens for bots.
    - Tokens are signed with an issuer key anchored in the ledger, with:
      - `iss` = issuer, `sub` = `bot_id`, plus `operator_id`, roles, expiry, etc.
    - Verifiers check tokens against the issuer’s public key and apply richer policy based on the claims.
- **Per-message signatures**:
  - Bots can additionally sign individual messages using the same key:
    - `signature` is computed over a canonical representation of stable fields (e.g., `from`, `from_id`, `operator_id`, `type`, `timestamp`, `message_id`, `body`).
  - Receivers:
    - Fetch or cache the bot’s public key from the ledger.
    - Verify the message signature before acting.
  - This provides end-to-end integrity even if the broker is untrusted.

### Key Management

- **Phase 1–2 (PoC)**:
  - Each bot uses an **Ed25519 keypair** for signing tokens and messages.
  - On startup, a bot:
    - Checks for an existing key at a well-known location (e.g., `~/.openclaw/keys/{bot_id}.key`).
    - If missing, generates a new Ed25519 keypair.
    - Stores the private key in that file with restrictive permissions (e.g., `0600`).
    - Registers or updates its public key in the identity ledger (`bot-identity-ledger.json`).
  - Optionally encrypt private keys at rest with a passphrase from an environment variable (e.g., `OPENCLAW_KEY_PASSPHRASE`) and a simple KDF.
  - **Key rotation**:
    - Bots rotate keys without downtime by:
      - Generating a new keypair and adding the public key to the ledger (e.g., with `status: "pending"` or a `valid_from` timestamp).
      - Publishing a signed key-rotation message that references both the old and new keys (proving continuity using the old key).
      - During a grace window, accepting signatures from both old and new keys.
      - After the window, marking the new key `status: "active"` and the old key `status: "revoked"`, then deleting the old private key.
- **Phase 3+**:
  - Introduce a pluggable key provider abstraction:
    - File-based keystore (default).
    - OS keychain or cloud KMS/HSM for higher assurance.
  - All signing and verification go through a small API (`sign`, `get_public_key`) that hides the underlying storage.

### Authentication
- **Phase 1–2 (PoC, small scale)**:
  - Use **username/password** auth per bot for simplicity.
  - Environment variables provide credentials: `MQTT_USERNAME`, `MQTT_PASSWORD`.
  - Prefer TLS (`mqtts://` or `wss://`) when available.
  - Optionally begin experimenting with identity tokens embedded in:
    - MQTT `password` field (CONNECT), or
    - Message-level `identity_token`.
- **Phase 3+ (higher security)**:
  - Migrate broker authentication to be fully **on-chain identity aware**:
    - Use **mutual TLS** where each bot presents a client cert whose public key is registered on-chain, or
    - Use **identity tokens** in MQTT CONNECT (e.g., `password` is a signed token) validated against on-chain keys.
  - Broker enforces:
    - Connection acceptance based on token/cert verification and on-chain status (bot/operator not revoked).
    - Mapping from verified `bot_id` / `operator_id` to ACLs and quotas.

### Authorization (ACLs)
- Per-bot ACLs restrict which topics can be published/subscribed:
  - `france-bot`:
    - `SUB`: `bots/france-bot/#`, `bots/all/#`, selected `bots/channels/#`, `dm/france-bot-+/coordination`, etc.
    - `PUB`: `bots/france-bot/status`, `bots/all/announce`, `bots/tooter-bot/inbox`, `dm/france-bot-tooter-bot/#`, etc.

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
- Do **not** retain individual task or coordination events; rely on QoS + sessions.

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
  - Signing every single message adds some overhead; Ed25519 is fast, but not free.
  - Not all messages are equally sensitive.
- **Recommended policy**:
  - **Must sign**:
    - Messages that can change world state or coordination decisions:
      - `type = request | response | coordination | error`.
      - Any task assignment, resource access, or non-idempotent operation.
  - **Optional to sign**:
    - `type = status` (heartbeats, simple telemetry), unless there is a specific threat model requiring authenticated liveness.
  - Implementation:
    - Sign a **canonical representation** of the message envelope, not just the body.
    - Reuse the same signing API and keys as identity tokens.

### Canonical Signing Format

To ensure interoperability across implementations, all bots must use the same canonicalization algorithm when signing and verifying messages:

- **Fields included in the signature**:
  - `from`, `from_id`, `operator_id`, `to`, `to_id`, `type`, `subtype`, `timestamp`, `message_id`, `correlation_id`, `body`
  - Omit any of these fields that are `null`/`undefined` in the concrete message.
  - **Do not** include `signature`, `signature_scheme`, or `identity_token` in the signed content.
- **Canonicalization rules**:
  - Build an object containing exactly the included fields.
  - Serialize to JSON with:
    - Keys sorted lexicographically.
    - No additional whitespace beyond what the JSON encoder requires.
    - UTF-8 encoding of the resulting string.
  - Sign the resulting byte sequence with the bot’s Ed25519 private key.

Conceptual example (JavaScript-style):

```javascript
const canonicalFields = {
  from: msg.from,
  from_id: msg.from_id,
  operator_id: msg.operator_id,
  to: msg.to,
  to_id: msg.to_id,
  type: msg.type,
  subtype: msg.subtype,
  timestamp: msg.timestamp,
  message_id: msg.message_id,
  correlation_id: msg.correlation_id,
  body: msg.body
};

// Remove undefined/null fields
for (const key of Object.keys(canonicalFields)) {
  if (canonicalFields[key] === undefined || canonicalFields[key] === null) {
    delete canonicalFields[key];
  }
}

const canonical = JSON.stringify(
  canonicalFields,
  Object.keys(canonicalFields).sort()
);
const signature = ed25519_sign(privateKey, canonical);
```

Other languages must produce the same canonical JSON string (sorted keys, same included fields) to ensure signatures verify consistently.

---

## Phased Implementation Plan

### Phase 1: Proof of Concept
1. Define requirements (this document).
2. Implement a simple local identity ledger:
   - Create `bot-identity-ledger.json` (or equivalent storage) with `operators` and `bots` sections.
   - Define fields for keys, status, created/updated timestamps.
3. Implement key management for bots:
   - On startup, each bot loads or generates an Ed25519 keypair under `~/.openclaw/keys/{bot_id}.key`.
   - Register or update the bot’s public key in the identity ledger.
4. Set up MQTT broker (Mosquitto in Docker, username/password auth).
5. Create and test topic structure with CLI tools (`mosquitto_pub/sub`).
6. Build `mqtt` skill for OpenClaw with `mqtt_connect`, `mqtt_publish`, `mqtt_subscribe`, `mqtt_unsubscribe`, `mqtt_poll`.
7. Test France-bot ↔ Tooter-bot basic messaging via:
   - `bots/all/announce`
   - `bots/tooter-bot/inbox`
   - `bots/france-bot/inbox`
   - `bots/france-tooter/coordination`

### Phase 2: Core Functionality
6. Implement and enforce the message format spec (validation, error handling).
7. Introduce the identity access layer:
   - Implement a small library for bots, services, and broker plugins to query the ledger:
     - `get_bot(bot_id)`, `get_operator(operator_id)`, `list_keys(bot_id)`, etc.
   - Encapsulate ledger storage behind this interface to allow future migration to a real chain or DID system.
8. Harden authn/authz (broker ACLs, TLS) and begin integrating identity tokens and signatures:
   - Allow bots to include `identity_token` in messages.
   - Add message signing and verification for `type = request | response | coordination | error`.
   - Optionally support token-based MQTT CONNECT authentication in parallel with username/password.
9. Implement channel discovery using:
   - Retained `bots/channels/{channel-id}/status` messages.
   - Optional `bots/channels/_index` for channel listing.
10. Build a human monitoring dashboard:
   - Subscribes to `bots/#` or `monitor/events`.
   - Filters by `from`, `to`, `type`, `privacy`, and topic.
11. Document usage patterns and examples in `TOOLS.md` and skill docs.

### Phase 3: Polish & Scale
12. Add message persistence and replay:
    - Archive selected topics.
    - Support refeeding messages for debugging or load-tests.
13. Implement rate limiting:
    - Per-bot or per-topic limits to avoid overload.
14. Create a bot registration system tied to on-chain identity:
    - Registration flow that creates/updates `bot_id` and links it to an `operator_id`.
    - Management tools for operators to rotate keys and view their bots.
15. Build a coordination patterns library:
    - Common flows like leader election, work-stealing, task claiming.
16. Add operator- and bot-level reputation:
    - Aggregate behavior metrics and attestations keyed by `bot_id` and `operator_id`.
    - Expose reputation scores for bots and operators to guide trust and policy.
17. Test with 3+ bots under realistic workloads and failure scenarios, including identity and reputation edge cases (revocation, key rotation, low-reputation operators).

---

## Recommended Implementation Workflow

To move from design to a working proof of concept, follow this order of operations:

1. **Define the MQTT skill contract**:
   - Create `/app/skills/mqtt/SKILL.md` describing:
     - The five core functions: `mqtt_connect`, `mqtt_publish`, `mqtt_subscribe`, `mqtt_unsubscribe`, `mqtt_poll`.
     - Usage examples for OpenClaw bots (connect → subscribe → publish → poll).
     - Error handling semantics (connection failures, timeouts, malformed payloads).
     - How and when message signing is integrated (e.g., signing before `mqtt_publish`, verification after `mqtt_poll`).
2. **Implement the identity access layer**:
   - Provide a small library (e.g., `identity-ledger.{js,ts,py}`) exposing:
     - `get_bot(bot_id)` – returns a bot record from the ledger.
     - `get_operator(operator_id)` – returns an operator record.
     - `list_keys(bot_id)` – returns active public keys for a bot.
     - `sign_message(msg, key_id)` – applies the canonical signing format to a message and returns a signed envelope.
     - `verify_signature(msg)` – verifies a signed message against keys from the ledger.
   - Internally, this library:
     - Reads `bot-identity-ledger.json`.
     - Loads bot keys from `~/.openclaw/keys/{bot_id}.key`.
     - Uses the canonical signing rules defined above.
3. **Update bot tooling configuration (`TOOLS.md`)**:
   - For each bot (starting with `france-bot`), document:
     - MQTT broker URL (configurable via env var, starting with local dev broker).
     - Default subscribed topics and publish targets.
     - Signing policy (which message types must be signed vs. optional).
     - Locations for identity ledger and key files.
4. **Create a setup/onboarding guide for new bots**:
   - Step-by-step instructions for:
     - Provisioning or generating keys.
     - Registering `bot_id` and `operator_id` in the ledger.
     - Configuring `TOOLS.md` and environment variables.
     - Running a basic “hello” flow (announce + direct inbox message) between two bots.

---

## Broker Location and Environment Considerations

- **Phase 1 (local development)**:
  - Run Mosquitto locally (e.g., via Docker) on the same machine as at least one bot.
  - Use a non-TLS URL such as `mqtt://localhost:1883` or `mqtt://<LAN-IP>:1883` for early testing.
  - Rely on:
    - Simple username/password authentication.
    - Local network trust plus message-level signatures for integrity.
- **Phase 2+ (shared dev / staging / production)**:
  - Move the broker to a VPS or managed MQTT service with a stable hostname (e.g., `mqtts://mqtt.example.com:8883`).
  - Enable TLS and stricter firewall rules.
  - Keep broker location and credentials fully configurable:
    - `BROKER_URL`, `MQTT_USERNAME`, `MQTT_PASSWORD`, and CA/client cert paths via environment variables or config files.
  - Maintain the same MQTT skill and identity layers so migrating from local to remote broker is a configuration change, not a code change.

---

## Success Criteria

- **Direct messaging**: France-bot and Tooter-bot can send and receive direct messages reliably.
- **Autonomous coordination**: Bots can coordinate work without human intervention.
- **Human observability**: Humans can monitor and debug bot coordination traffic.
- **Easy onboarding**: Adding a new bot to the mesh is straightforward via TOOLS.md config and credentials.
- **Selective visibility**: Bots only see channels and topics they explicitly join.
- **Reliable delivery**: No silent failures; at-least-once semantics for important messages, with logging on errors.
- **Clear documentation**: This document and supporting `TOOLS.md`/skill docs are sufficient for future bots to self-onboard.


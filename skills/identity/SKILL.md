---
name: identity
description: Verify on-chain bot registration, fetch bot records, sign coordination messages (EIP-712 / secp256k1), and issue SIWE MQTT CONNECT passwords.
metadata:
  {"openclaw":{"requires":{"env":["CHAIN_RPC_URL","REGISTRY_ADDRESS"]},"primaryEnv":"CHAIN_RPC_URL"}}
---

# Identity skill

Use this skill when:

- **Bootstrapping or restarting a bot**: verify that the operator and bot exist on-chain (`ClankerIdentity`) and that this bot's secp256k1 address matches the registered `botKey`.
- **Sending a signed message** to another bot over MQTT (or any channel): produce an EIP-712 signed envelope so the recipient can verify authenticity.
- **Looking up a bot's record** (e.g. public keys, operator, status) for debugging or coordination.

This skill wraps `@clanker-chain/identity-node-client` (RPC reads). Registration happens on-chain (`clanker chain mint-*`), not via HTTP POST. The deprecated `identity-service` indexer is not required.

---

## Configuration

At minimum, you must configure:

- **Chain RPC + registry**:
  - Env: `CHAIN_RPC_URL` (e.g. `https://sepolia.base.org` or `http://127.0.0.1:8545`)
  - Env: `REGISTRY_ADDRESS` (ClankerIdentity `0x…`)
- **Bot identity**:
  - `bot_id`: canonical bot id, for example: `openclaw.france.prod-1`
  - Local private key path: `~/.openclaw/keys/{bot_id}.key` (`0x` + 64 hex secp256k1)
- **Operator identity**:
  - `operator_id`: operator that owns the bot, for example: `org.openclaw.pat`

The default key path is derived from `bot_id`:

- `~/.openclaw/keys/{bot_id}.key` (e.g. `~/.openclaw/keys/openclaw.france.prod-1.key`)

The **mint / registration step is performed by the operator on-chain**, not by this skill:

1. Operator registers the bot on-chain (generates key file):

   ```bash
   node clanker-cli/bin/clanker.mjs chain mint-bot openclaw.france.prod-1 org.openclaw.pat --registry "$REGISTRY"
   ```

2. The private key file is securely copied to the bot host and kept at `~/.openclaw/keys/openclaw.france.prod-1.key` (mode `0600`).

3. Ensure `CHAIN_RPC_URL` and `REGISTRY_ADDRESS` are set so bots can read `ClankerIdentity` over RPC.

After this one-time registration, the **bot** uses this skill to verify its identity and sign messages; it does not perform registration itself.

**OpenClaw outbound MQTT:** for signed direct messages to another bot, prefer the gateway tool **`mqtt_send`** from [`@clanker-chain/mqtt-tools`](../../openclaw-extensions/mqtt-tools-plugin/README.md) (or core `message` on profiles that include it). This skill covers `identity_sign` for custom/exec flows; the mqtt-tools plugin wraps sign + publish to `bots/{canonicalBotId}/inbox`.

---

## Commands

Run these from the workspace root. Replace `{baseDir}` with the path to this skill folder (e.g. `skills/identity`).

### identity_init — verify bot and key

Call once per bot at startup (idempotent). Ensures:

- The operator exists and has `status: "active"`.
- The bot exists and has `status: "active"`.
- This bot's local secp256k1 address (derived from `~/.openclaw/keys/{bot_id}.key`) matches the active on-chain `botKey`.

```bash
node {baseDir}/run.mjs init <bot_id> <operator_id>
```

Example (canonical pairing from this repo):

```bash
node skills/identity/run.mjs init openclaw.france.prod-1 org.openclaw.pat
```

Requires `CHAIN_RPC_URL` and `REGISTRY_ADDRESS`.

On **success**, `identity_init` prints JSON to stdout:

```json
{
  "ok": true,
  "bot_id": "openclaw.france.prod-1",
  "operator_id": "org.openclaw.pat",
  "chain_rpc_url": "https://sepolia.base.org",
  "registry_address": "0xD650467f9D7A20f37E55ec23Ca1c711598f97958",
  "bot_key": "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
  "bot": { "...": "full bot record from chain" }
}
```

On **failure**, it writes a JSON error to stderr and exits with a non-zero code:

```json
{ "error": "Operator not registered. Register the operator on-chain first (clanker chain mint-operator)." }
```

### identity_get_bot — fetch bot record

Returns the full bot record from chain (`RegistryClient` / `IdentityClient.getBot()`).

```bash
node {baseDir}/run.mjs get-bot <bot_id>
```

Example:

```bash
node skills/identity/run.mjs get-bot openclaw.tooter.prod-1
```

### identity_sign — sign a message envelope

Signs a JSON message envelope with EIP-712 (`signature_scheme: "eip712-secp256k1"`). The `body` field is canonicalized with sorted JSON keys before hashing.

```bash
node {baseDir}/run.mjs sign '<envelope_json>'
```

The envelope must include at least: `from`, `from_id`, `operator_id`, `type`, `timestamp`, `message_id`, `body`. Optional: `to`, `to_id`, `subtype`, `channel`, `correlation_id`.

Example (escape the JSON for the shell):

```bash
node skills/identity/run.mjs sign '{"from":"france-bot","from_id":"openclaw.france.prod-1","operator_id":"org.openclaw.pat","to":"tooter-bot","to_id":"openclaw.tooter.prod-1","type":"coordination","timestamp":"2026-03-09T12:00:00Z","message_id":"msg-1","body":{"action":"ping"}}'
```

Output is JSON with `signature`, `signature_scheme`, and `envelope` (the full signed envelope to publish).

### identity_verify — detailed registration check

Runs a non-throwing health check against on-chain registration for a given bot/operator pair.

```bash
node {baseDir}/run.mjs verify <bot_id> <operator_id>
```

Example:

```bash
node skills/identity/run.mjs verify openclaw.france.prod-1 org.openclaw.pat
```

On **success**, it prints a summary JSON object and exits with code 0. If something is wrong, it sets `ok: false` and populates `error`.

### identity_issue_mqtt_password — SIWE CONNECT password

Fetches a nonce from mqtt-auth-service, signs the auth message with this bot's secp256k1 key, and returns `<nonce>.<signatureHex>` for MQTT CONNECT (username = `bot_id`).

Requires `MQTT_AUTH_SERVICE_URL` (or defaults derived from your MQTT broker setup).

```bash
node {baseDir}/run.mjs issue-mqtt-password <bot_id> <operator_id>
```

Example:

```bash
node skills/identity/run.mjs issue-mqtt-password openclaw.france.prod-1 org.openclaw.pat
```

Output is the raw password string on stdout (no JSON wrapper).

## Environment

- **CHAIN_RPC_URL** (required): EVM JSON-RPC URL (e.g. `https://sepolia.base.org`).
- **REGISTRY_ADDRESS** (required): `ClankerIdentity` contract address.
- **MQTT_AUTH_SERVICE_URL** (for issue-mqtt-password): Base URL of mqtt-auth-service (e.g. `http://localhost:9090`).

Keys are stored under `~/.openclaw/keys/<bot_id>.key`. Do not share or commit this file.

---

## Packaging and deployment (OpenClaw skills and plugins)

This skill is designed to be **small and thin** on the bot. On-chain registration stays on the operator side (`clanker-cli`); bots only need:

- A private key file under `~/.openclaw/keys/<bot_id>.key`.
- Network access to chain RPC (`CHAIN_RPC_URL` + `REGISTRY_ADDRESS`) and mqtt-auth for SIWE nonces.
- `@clanker-chain/identity-node-client` (or `@clanker-chain/mqtt-channel-plugin` which bundles it).

### Skills vs plugins

Per the [OpenClaw Skills docs](https://www.learnclawdbot.org/docs/tools/skills):

- A **skill** is a directory with a `SKILL.md` manifest that describes tools/commands.
- Skills can be workspace skills (e.g. `skills/identity` in this repo) or plugin-provided skills.

Use `@clanker-chain/identity-node-client` from this repo or a published CalVer after release (not the deprecated `@clanker-chain/identity-plugin`).

---

## Error handling

Common failure modes and what they mean:

- **RPC unreachable / connection error**: treat as infrastructure outage; retry with backoff.
- **"Operator not registered"** from `identity_init`: register the operator on-chain first (`clanker chain mint-operator`).
- **ChainId / registry misconfig**: ensure `CHAIN_RPC_URL` and `REGISTRY_ADDRESS` match the network you minted on.
- **Operator or bot not active**: on-chain revocation; operator must re-register or un-revoke.
- **Missing key file**: if `~/.openclaw/keys/{bot_id}.key` does not exist or is unreadable, the bot cannot sign; fix key provisioning rather than silently generating a new key.

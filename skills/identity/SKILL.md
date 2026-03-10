---
name: identity
description: Register this bot with the identity service, fetch bot records, and sign coordination messages (Ed25519) for the bot mesh.
metadata:
  {"openclaw":{"requires":{"env":["IDENTITY_SERVICE_URL"]},"primaryEnv":"IDENTITY_SERVICE_URL"}}
---

# Identity skill

Use this skill when:

- **Initializing this bot** on first run or after a reset: register the bot and its public key with the identity service so other bots can verify signatures.
- **Sending a signed message** to another bot over MQTT (or any channel): produce a signed envelope so the recipient can verify authenticity.
- **Looking up a bot’s record** (e.g. public keys, operator, status) for debugging or coordination.

## Commands

Run these from the workspace root. Replace `{baseDir}` with the path to this skill folder (e.g. `skills/identity`).

### identity_init — register bot and key

Call once per bot at startup (idempotent). Ensures the operator and bot exist in the identity service and registers this bot’s Ed25519 public key.

```bash
node {baseDir}/run.mjs init <bot_id> <operator_id>
```

Example:

```bash
node skills/identity/run.mjs init openclaw.france.prod-1 org.openclaw.pat
```

- **bot_id**: Canonical bot ID (e.g. `openclaw.france.prod-1`).
- **operator_id**: Operator that owns the bot (e.g. `org.openclaw.pat`).

Requires `IDENTITY_SERVICE_URL` (and `IDENTITY_ADMIN_TOKEN` if the identity service enforces auth).

### identity_get_bot — fetch bot record

Returns the full bot record from the identity service (public keys, operator_id, status).

```bash
node {baseDir}/run.mjs get-bot <bot_id>
```

Example:

```bash
node skills/identity/run.mjs get-bot openclaw.tooter.prod-1
```

### identity_sign — sign a message envelope

Signs a JSON message envelope with this bot’s Ed25519 key. Use the returned `envelope` (with `signature` and `signature_scheme`) when publishing to MQTT or other channels.

```bash
node {baseDir}/run.mjs sign '<envelope_json>'
```

The envelope must include at least: `from`, `from_id`, `operator_id`, `type`, `timestamp`, `message_id`, `body`. Optional: `to`, `to_id`, `subtype`, `channel`, `correlation_id`.

Example (escape the JSON for the shell):

```bash
node skills/identity/run.mjs sign '{"from":"france-bot","from_id":"openclaw.france.prod-1","operator_id":"org.openclaw.pat","to":"tooter-bot","to_id":"openclaw.tooter.prod-1","type":"coordination","timestamp":"2026-03-09T12:00:00Z","message_id":"msg-1","body":{"action":"ping"}}'
```

Output is JSON with `signature`, `signature_scheme`, and `envelope` (the full signed envelope to publish).

## Environment

- **IDENTITY_SERVICE_URL** (required): Base URL of the identity service (e.g. `http://localhost:8080`).
- **IDENTITY_ADMIN_TOKEN** (optional): Admin bearer token for init; required if the identity service protects write endpoints.

Keys are stored under `~/.openclaw/keys/<bot_id>.key`. Do not share or commit this file.

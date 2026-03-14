---
name: identity
description: Register this bot with the identity service, fetch bot records, and sign coordination messages (Ed25519) for the bot mesh.
metadata:
  {"openclaw":{"requires":{"env":["IDENTITY_SERVICE_URL"]},"primaryEnv":"IDENTITY_SERVICE_URL"}}
---

# Identity skill

Use this skill when:

- **Bootstrapping or restarting a bot**: verify that the operator and bot exist in the identity service and that this bot’s public key is registered, so other bots can verify its signatures.
- **Sending a signed message** to another bot over MQTT (or any channel): produce a signed envelope so the recipient can verify authenticity.
- **Looking up a bot’s record** (e.g. public keys, operator, status) for debugging or coordination.

This skill is a thin wrapper around the `identity-node-client` library and expects the underlying clanker-chain identity service to use **proof-based authorization** (Ed25519 signatures). No Bearer admin token is required in the default setup.

---

## Configuration

At minimum, you must configure:

- **Identity service URL**:
  - Env: `IDENTITY_SERVICE_URL`
  - Example: `http://localhost:8080` or `http://identity-service:8080`
- **Bot identity**:
  - `bot_id`: canonical bot id, for example: `openclaw.france.prod-1`
  - Local private key path: `~/.openclaw/keys/{bot_id}.key`
- **Operator identity**:
  - `operator_id`: operator that owns the bot, for example: `org.openclaw.pat`

The default key path is derived from `bot_id`:

- `~/.openclaw/keys/{bot_id}.key` (e.g. `~/.openclaw/keys/openclaw.france.prod-1.key`)

The **mint / registration step is performed by the operator**, not by this skill:

1. The operator uses the identity-service CLI to generate a **mint-bot token**:

   ```bash
   cd identity-service
   bun run src/cli.ts mint-bot-token openclaw.france.prod-1 org.openclaw.pat "France Bot"
   ```

2. The CLI:
   - Ensures the operator key exists (and creates it if missing).
   - Generates a new bot keypair and writes the private key to `~/.openclaw/keys/openclaw.france.prod-1.key`.
   - Prints a JSON payload that can be POSTed directly to `POST /v1/bots` on the identity service.

3. The operator (or deployment pipeline) POSTs that payload once:

   ```bash
   curl -X POST "$IDENTITY_SERVICE_URL/v1/bots" \
     -H "content-type: application/json" \
     -d '@mint-bot-payload.json'
   ```

4. The private key file is then securely copied to the bot host and kept at `~/.openclaw/keys/openclaw.france.prod-1.key` (mode `0600`).

After this one-time registration, the **bot** uses this skill to verify its identity and sign messages; it does not perform registration itself.

---

## Commands

Run these from the workspace root. Replace `{baseDir}` with the path to this skill folder (e.g. `skills/identity`).

### identity_init — verify bot and key

Call once per bot at startup (idempotent). Ensures:

- The operator exists in the identity service.
- The bot exists in the identity service.
- This bot’s local Ed25519 public key (derived from `~/.openclaw/keys/{bot_id}.key`) is present and active in the bot record.

```bash
node {baseDir}/run.mjs init <bot_id> <operator_id>
```

Example (canonical pairing from this repo):

```bash
node skills/identity/run.mjs init openclaw.france.prod-1 org.openclaw.pat
```

- **bot_id**: Canonical bot ID (e.g. `openclaw.france.prod-1`).
- **operator_id**: Operator that owns the bot (e.g. `org.openclaw.pat`).

Requires `IDENTITY_SERVICE_URL`. The default identity service in this repo does **not** use `IDENTITY_ADMIN_TOKEN`; all writes are authorized by Ed25519 signatures.

On **success**, `identity_init` prints JSON to stdout:

```json
{
  "ok": true,
  "bot_id": "openclaw.france.prod-1",
  "operator_id": "org.openclaw.pat",
  "identity_service_url": "http://localhost:8080",
  "public_key": "<base64-bot-public-key>",
  "bot_has_active_key": true,
  "bot": {
    "bot_id": "openclaw.france.prod-1",
    "operator_id": "org.openclaw.pat",
    "public_keys": [
      {
        "key_id": "...",
        "algorithm": "ed25519",
        "public_key": "<base64-bot-public-key>",
        "created": "...",
        "status": "active"
      }
    ],
    "status": "active",
    "created": "...",
    "updated": "..."
  }
}
```

On **failure**, it writes a JSON error to stderr and exits with a non‑zero code:

```json
{ "error": "Operator not registered. Operator must be minted first (genesis or mint-operator)." }
```

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

### identity_verify — detailed registration check

Runs a non‑throwing health check against the identity service for a given bot/operator pair.

```bash
node {baseDir}/run.mjs verify <bot_id> <operator_id>
```

Example:

```bash
node skills/identity/run.mjs verify openclaw.france.prod-1 org.openclaw.pat
```

On **success**, it prints a summary JSON object and exits with code 0:

```json
{
  "ok": true,
  "bot_id": "openclaw.france.prod-1",
  "operator_id": "org.openclaw.pat",
  "identity_service_url": "http://localhost:8080",
  "operator": { "exists": true },
  "bot": { "exists": true },
  "key": {
    "matches": true,
    "public_key": "<base64-bot-public-key>"
  },
  "error": null
}
```

If something is wrong (operator missing, bot missing, or key mismatch), it still exits with code 0 but sets `ok: false` and populates `error`:

```json
{
  "ok": false,
  "bot_id": "openclaw.france.prod-1",
  "operator_id": "org.openclaw.pat",
  "identity_service_url": "http://localhost:8080",
  "operator": { "exists": true },
  "bot": { "exists": true },
  "key": {
    "matches": false,
    "public_key": "<base64-bot-public-key>"
  },
  "error": "bot exists but does not have an active public key matching the local key"
}
```

This makes `identity_verify` a good choice for periodic health checks or diagnostics, while `identity_init` is best for strict startup gating.

### identity_issue_mqtt_token — issue MQTT broker auth token

Issues a short-lived JWT signed with this bot’s Ed25519 key for MQTT broker authentication. Use the output as the MQTT CONNECT password with username = `bot_id`.

```bash
node {baseDir}/run.mjs issue-mqtt-token <bot_id> <operator_id> [ttl_sec]
```

Example:

```bash
node skills/identity/run.mjs issue-mqtt-token openclaw.france.prod-1 org.openclaw.pat 300
```

- **bot_id**: Canonical bot ID (e.g. `openclaw.france.prod-1`).
- **operator_id**: Operator that owns the bot (e.g. `org.openclaw.pat`).
- **ttl_sec** (optional): Token lifetime in seconds (default 300).

Output is the raw JWT string on stdout (no JSON wrapper). Use it as the password when connecting to the MQTT broker with username = `bot_id`. The MQTT skill or client can call this to obtain a token for `mqtt_connect`.

## Environment

- **IDENTITY_SERVICE_URL** (required): Base URL of the identity service (e.g. `http://localhost:8080`).

Keys are stored under `~/.openclaw/keys/<bot_id>.key`. Do not share or commit this file.

---

## Packaging and deployment (OpenClaw skills and plugins)

This skill is designed to be **small and thin** on the bot. The heavy lifting (ledger, HTTP service, operator CLI) stays on the operator’s machine; bots only need:

- A private key file under `~/.openclaw/keys/<bot_id>.key`.
- Network access to the identity service (`IDENTITY_SERVICE_URL`).
- A thin identity client library (for example, an `@openclaw/identity-client` extension) that this skill can import.

### Skills vs plugins

Per the [OpenClaw Skills docs](https://www.learnclawdbot.org/docs/tools/skills):

- A **skill** is a directory with a `SKILL.md` manifest that describes tools/commands.
- Skills can be:
  - Workspace skills (e.g. `skills/identity` in this repo).
  - Plugin‑provided skills, listed in a plugin’s `openclaw.plugin.json`.

Per the [OpenClaw plugin docs](https://docs.openclaw.ai/plugin):

- Every plugin has an `openclaw.plugin.json` with an `id`, `name`, `description`, and `configSchema`.
- Plugins can ship their own skills by listing skill directories (paths relative to the plugin root) in the manifest.

This repo provides the **skill manifest and CLI wrapper** (`run.mjs`); you typically package the identity client code itself as a plugin/extension in your OpenClaw environment and point this skill at it.

### Typical packaging flow

1. In your OpenClaw plugin or bot image source repo (separate from this identity service repo), create an extension under `openclaw/extensions/identity-client` that:
   - Wraps the `IdentityClient` implementation (for example by re‑exporting `identity-node-client` from this repo).
   - Has its own `package.json` and `openclaw.plugin.json` (see `identity/SERVICE.md` for example manifests).
2. In your Dockerfile for bot images (on the Ubuntu host):
   - `COPY` the extension directory into the image (e.g. `/app/openclaw/extensions/identity-client`).
   - Run `npm install && npm run build` in that directory.
   - From the skill directory (`/app/skills/identity`), run `npm install /app/openclaw/extensions/identity-client` so that:

   ```js
   import { IdentityClient } from "@openclaw/identity-client";
   ```

   resolves inside `run.mjs`.
3. Copy only `SKILL.md` (and optionally `run.mjs`) into `skills/identity/` in the image, or point the plugin’s `skills` array at your workspace skill directory.

With this setup, bots do not need any of the identity service or ledger code; they only need:

- The **extension** providing the identity client library.
- This **skill** describing how to call it.
- Their own private key and the identity service URL.

---

## Error handling

Common failure modes and what they mean:

- **Service unreachable / connection error**: treat as infrastructure outage; retry with backoff, and surface that the identity service is offline.
- **\"Operator not registered\"** from `identity_init`: the operator has not been minted into the ledger; run genesis or `mint-operator` first.
- **\"Bot not registered or key not found\"** from `identity_init`: the bot has not been minted with this public key; rerun the operator-side mint-bot-token flow and POST to `/v1/bots`.
- **Missing key file**: if `~/.openclaw/keys/{bot_id}.key` does not exist or is unreadable, the bot cannot sign; fix key provisioning rather than silently generating a new key.

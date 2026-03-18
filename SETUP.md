# clanker-chain MQTT & Identity Setup

This guide shows how to install and wire the identity service, MQTT client plugin, and MQTT channel provider for OpenClaw.

It covers three paths:

- **MQTT only** — use a static password/JWT with no identity service.
- **Identity only** — run the identity service and mint bots, without MQTT.
- **Full stack** — combine identity + MQTT for cryptographic auth and bot-to-bot messaging.

## 1. Core identifiers and config mapping

For all modes, the same identifiers and config surface are used:

- **BOT_ID** — canonical bot id, e.g. `openclaw.test.local`. This is:
  - The MQTT client id (`MQTT_CLIENT_ID`).
  - The `botId` in the `mqtt` channel config.
- **OPERATOR_ID** — operator id, e.g. `org.openclaw.operator`. This is:
  - The operator recorded in the identity service.
  - The `operatorId` in the `mqtt` channel config.

Environment and channel config line up as:

- `MQTT_BROKER_URL` ↔ `brokerUrl`
- `IDENTITY_SERVICE_URL` ↔ `identityServiceUrl`
- `BOT_ID` / `MQTT_CLIENT_ID` ↔ `botId`
- `OPERATOR_ID` ↔ `operatorId`

## 2. MQTT only (no identity service)

Use this for quick local testing or simple brokers that use a static password.

### 1.1 Install the MQTT client plugin

In your OpenClaw workspace or bot image:

```bash
openclaw plugins install @clanker-chain/mqtt-plugin
```

Or from a local path: `openclaw plugins install /path/to/clanker-chain/mqtt-client-plugin`

Enable the plugin in your OpenClaw config (for example via `plugins.enabled` with id `clanker-chain-mqtt`) as documented by OpenClaw.

### 1.2 Configure environment

Set the following env vars for the bot process:

```bash
export MQTT_BROKER_URL="mqtt://localhost:1883"
export MQTT_CLIENT_ID="openclaw.test.local"

# Choose ONE of:
export MQTT_PASSWORD="test-jwt-or-secret"        # static JWT / opaque password
# or:
export MQTT_STATIC_PASSWORD="test-password"      # simple broker password
```

### 1.3 Quick health check

```bash
cd /path/to/clanker-chain
./scripts/check-mqtt.sh openclaw.test.local org.openclaw.operator
```

This runs the MQTT skill's `connect` command using the configured auth mode and reports `{ "ok": true }` on success.

## 3. Identity only

Use this when you want to manage bot identities and keys, but are not yet wiring MQTT.

### 2.1 Run the identity service

```bash
cd /path/to/clanker-chain/identity-service
bun install
bun run src/server.ts
```

The service listens on `http://localhost:8080` by default (configurable via `IDENTITY_SERVICE_PORT`).

### 2.2 Mint an operator and bot

Use the CLI directly:

```bash
cd /path/to/clanker-chain/identity-service
bun run src/cli.ts mint-operator org.openclaw.operator
bun run src/cli.ts mint-bot openclaw.test.local org.openclaw.operator "Test bot"
```

Or use the helper script:

```bash
cd /path/to/clanker-chain/identity-service/scripts
./quick-mint.sh openclaw.test.local org.openclaw.operator
```

This writes keys under `~/.openclaw/keys/` and registers the operator/bot with the identity service.

### 2.3 Identity health check

```bash
cd /path/to/clanker-chain
./scripts/check-identity.sh org.openclaw.operator
```

On success this prints `{ "ok": true, "operator": { ... } }`.

## 4. Full stack (identity + MQTT)

Use this for production-like setups where MQTT auth is backed by cryptographic identity.

### 3.1 Run identity, MQTT broker, and mqtt-auth-service

Start identity service (as above), your MQTT broker, and the `mqtt-auth-service` from this repo as described in `mqtt-service/` and `mqtt-auth-service/`.

### 3.2 Mint bot identity

Use `quick-mint.sh` as in section 2.2 to mint `bot_id` and `operator_id` and generate the local bot key.

### 3.3 Configure MQTT client plugin with identity-backed JWT

On the bot process:

```bash
export IDENTITY_SERVICE_URL="http://localhost:8080"
export MQTT_BROKER_URL="mqtt://localhost:1883"
export MQTT_CLIENT_ID="openclaw.test.local"
```

Do **not** set `MQTT_PASSWORD` or `MQTT_STATIC_PASSWORD`; with `IDENTITY_SERVICE_URL` set, the MQTT skill uses `identity-node-client` to issue a short-lived JWT per connection.

You can verify connectivity:

```bash
cd /path/to/clanker-chain
./scripts/check-mqtt.sh openclaw.test.local org.openclaw.operator
```

## 5. MQTT channel provider for OpenClaw

The `mqtt-channel-plugin` exposes an OpenClaw channel named `mqtt`. Example `openclaw.json` snippet:

```json5
{
  "channels": {
    "mqtt": {
      "enabled": true,
      "botId": "openclaw.test.local",
      "operatorId": "org.openclaw.operator",
      "brokerUrl": "mqtt://localhost:1883",
      "identityServiceUrl": "http://localhost:8080"
    }
  }
}
```

Topic defaults (configurable in channel config):

- Inbox: `bots/{botId}/inbox`
- Announce: `bots/all/announce`
- Status: `bots/{botId}/status`

## 6. Testing matrix (recommended)

Use this matrix to verify your setup:

1. **MQTT only + static password**
   - Set `MQTT_BROKER_URL`, `MQTT_CLIENT_ID`, `MQTT_STATIC_PASSWORD`.
   - Run `./scripts/check-mqtt.sh <bot_id> <operator_id>`.
2. **MQTT only + static JWT**
   - Set `MQTT_BROKER_URL`, `MQTT_CLIENT_ID`, `MQTT_PASSWORD`.
   - Run `./scripts/check-mqtt.sh <bot_id> <operator_id>`.
3. **Full stack (identity + MQTT)**
   - Run identity service and `quick-mint.sh`.
   - Set `IDENTITY_SERVICE_URL`, `MQTT_BROKER_URL`, `MQTT_CLIENT_ID`.
   - Run `./scripts/check-identity.sh <operator_id>` and `./scripts/check-mqtt.sh <bot_id> <operator_id>`.
4. **Identity only**
   - Run identity service.
   - Use `bun run src/cli.ts get-operator ...` / `get-bot ...` or `check-identity.sh` without configuring MQTT.

For end-to-end bot-to-bot tests, use the MQTT channel provider so that messages published to `bots/<bot>/inbox` appear in the OpenClaw session and replies are delivered back over MQTT.


---
name: mqtt
description: DEPRECATED — prefer @clanker-chain/mqtt-channel-plugin + @clanker-chain/mqtt-tools for OpenClaw bot-to-bot messaging.
metadata:
  {"openclaw":{"requires":{"env":["MQTT_BROKER_URL","MQTT_CLIENT_ID","CHAIN_RPC_URL","REGISTRY_ADDRESS"]},"primaryEnv":"MQTT_BROKER_URL"}}
---

# MQTT skill (DEPRECATED)

> Prefer **`@clanker-chain/mqtt-channel-plugin`** + **`@clanker-chain/mqtt-tools`** ([`SETUP.md`](../../SETUP.md)). This workspace skill remains for exec-style connect/publish/poll only.

Use this skill when this bot needs to communicate with other bots (e.g. tooter-bot, france-bot): connect to the broker, send direct messages, coordination messages, announce join/leave, or read from this bot's inbox.

Authentication is **SIWE-style**: username = `bot_id`, password = `<nonce>.<signatureHex>` from `IdentityClient.issueMqttConnectPassword()` (identity skill `identity_issue_mqtt_password` / mqtt-auth `GET /nonce`). JWT CONNECT is not supported.

Requires `CHAIN_RPC_URL` + `REGISTRY_ADDRESS` (and usually `MQTT_AUTH_SERVICE_URL`). Do not use `@clanker-chain/mqtt-plugin` for new installs.

---

## Configuration

- **MQTT_BROKER_URL** (required): e.g. `mqtt://localhost:1883` or `mqtts://broker.example.com:8883`
- **MQTT_CLIENT_ID** (required): Usually the bot's canonical id, e.g. `openclaw.france.prod-1`
- **MQTT_BOT_DISPLAY_NAME** (optional): Display name for default poll topics (e.g. `france-bot`). If unset, MQTT_CLIENT_ID is used for inbox topic.
- **CHAIN_RPC_URL** / **REGISTRY_ADDRESS**: Enable SIWE against ClankerIdentity.
- **MQTT_AUTH_SERVICE_URL** (optional): Nonce service (default `http://localhost:9090`).
- **Bot identity**: pass `bot_id` and `operator_id` as command args; key at `~/.openclaw/keys/{bot_id}.key`.

---

## Commands

Run from the workspace root. Replace `{baseDir}` with the path to this skill folder (e.g. `skills/mqtt`).

### mqtt_connect — verify connection

Connects with a fresh SIWE password, then disconnects. Use to verify broker reachability and auth.

```bash
node {baseDir}/run.mjs connect <bot_id> <operator_id>
```

Example:

```bash
node skills/mqtt/run.mjs connect openclaw.france.prod-1 org.openclaw.pat
```

Requires **MQTT_BROKER_URL** and **MQTT_CLIENT_ID**. Output: JSON `{ "ok": true }` or error.

### mqtt_publish — publish a message

Connects, publishes one message to a topic, then disconnects.

```bash
node {baseDir}/run.mjs publish <bot_id> <operator_id> <topic> '<json_payload>'
```

Example:

```bash
node skills/mqtt/run.mjs publish openclaw.france.prod-1 org.openclaw.pat "bots/tooter-bot/inbox" '{"type":"coordination","body":{"action":"ping"}}'
```

### mqtt_subscribe — subscribe to topics

Connects, subscribes to the given topics, then disconnects (subscription is not persistent across invocations; use mqtt_poll to receive messages in one shot).

```bash
node {baseDir}/run.mjs subscribe <bot_id> <operator_id> <topic1> [topic2 ...]
```

### mqtt_poll — receive messages

Connects, subscribes to the given topics, waits up to `timeout_ms`, returns received messages, then disconnects.

```bash
node {baseDir}/run.mjs poll <bot_id> <operator_id> [timeout_ms] [topic1] [topic2 ...]
```

If no topics are given, subscribes to this bot's inbox and announce (derived from MQTT_CLIENT_ID or bot_id). Example:

```bash
node skills/mqtt/run.mjs poll openclaw.france.prod-1 org.openclaw.pat 2000 "bots/france-bot/inbox" "bots/all/announce"
```

Output: JSON array of `{ "topic", "payload", "qos", "timestamp" }`.

---

## Topic helpers

Per bot-comms.md:

- **Inbox**: `bots/<bot_display_name>/inbox` (e.g. `bots/tooter-bot/inbox`)
- **Announce**: `bots/all/announce`
- **DM coordination**: `dm/<bot1>-<bot2>/coordination` (e.g. `dm/france-bot-tooter-bot/coordination`)
- **Status**: `bots/<bot>/status` (retained heartbeat)

Sign coordination/request/response messages with the identity skill (`identity_sign` / EIP-712) before publishing when required.

---

## Environment

- **MQTT_BROKER_URL** (required): Broker URL.
- **MQTT_CLIENT_ID** (required): Client id (usually bot_id).
- **CHAIN_RPC_URL** / **REGISTRY_ADDRESS**: SIWE auth against ClankerIdentity (same as identity skill).
- **MQTT_AUTH_SERVICE_URL**: Nonce service for SIWE (default `http://localhost:9090`).

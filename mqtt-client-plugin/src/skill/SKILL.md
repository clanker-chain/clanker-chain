---
name: mqtt
description: Connect to the MQTT broker and communicate with other bots (send DMs, coordination messages, announce join/leave, read inbox).
metadata:
  {"openclaw":{"requires":{"env":["MQTT_BROKER_URL","MQTT_CLIENT_ID"]},"primaryEnv":"MQTT_BROKER_URL"}}
---

# MQTT skill

Use this skill when this bot needs to communicate with other bots (e.g. tooter-bot, france-bot): connect to the broker, send direct messages, coordination messages, announce join/leave, or read from this bot's inbox.

Authentication supports:

- **SIWE (recommended)**: when `CHAIN_RPC_URL` and `REGISTRY_ADDRESS` are set, the skill uses `identity-node-client` for SIWE CONNECT (`nonce.sig`), with username = `bot_id`.
- **Static password**: when `MQTT_STATIC_PASSWORD` is set (and chain env is not), the value is used as a simple static password (dev only).

Auth precedence:

1. `CHAIN_RPC_URL` + `REGISTRY_ADDRESS`
2. `MQTT_STATIC_PASSWORD`

---

## Configuration

- **MQTT_BROKER_URL** (required): e.g. `mqtt://localhost:1883` or `mqtts://broker.example.com:8883`
- **MQTT_CLIENT_ID** (required): Usually the bot's canonical id, e.g. `openclaw.france.prod-1`
- **MQTT_BOT_DISPLAY_NAME** (optional): Display name for default poll topics (e.g. `france-bot`). If unset, `MQTT_CLIENT_ID` is used for inbox topic.
- **CHAIN_RPC_URL** / **REGISTRY_ADDRESS** (optional together): Enable SIWE auth against ClankerIdentity.
- **MQTT_AUTH_SERVICE_URL** (optional): SIWE nonce service (default `http://localhost:9090`).
- **MQTT_STATIC_PASSWORD** (optional): Simple static password when chain env is not set.
- **Bot identity**: pass `bot_id` and `operator_id` as command args; key at `~/.openclaw/keys/{bot_id}.key`.

---

## Commands

Run from the workspace root. Replace `{baseDir}` with the path to this skill folder (e.g. the plugin's `src/skill` or `skills/mqtt`).

### mqtt_connect — verify connection

Connects with a fresh SIWE password, then disconnects. Use to verify broker reachability and auth.

```bash
node {baseDir}/run.mjs connect <bot_id> <operator_id>
```

Requires **MQTT_BROKER_URL** and **MQTT_CLIENT_ID**. Output: JSON `{ "ok": true }` or error.

### mqtt_publish — publish a message

Connects, publishes one message to a topic, then disconnects.

```bash
node {baseDir}/run.mjs publish <bot_id> <operator_id> <topic> '<json_payload>'
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

If no topics are given, subscribes to this bot's inbox and announce. Output: JSON array of `{ "topic", "payload", "qos", "timestamp" }`.

---

## Topic helpers

Per bot-comms.md:

- **Inbox**: `bots/<bot_display_name>/inbox` (e.g. `bots/tooter-bot/inbox`)
- **Announce**: `bots/all/announce`
- **DM coordination**: `dm/<bot1>-<bot2>/coordination` (e.g. `dm/france-bot-tooter-bot/coordination`)
- **Status**: `bots/<bot>/status` (retained heartbeat)

Sign coordination/request/response messages with EIP-712 (`identity-node-client`) before publishing when required.

---

## Environment

- **MQTT_BROKER_URL** (required): Broker URL.
- **MQTT_CLIENT_ID** (required): Client id (usually `bot_id`).
- **MQTT_BOT_DISPLAY_NAME** (optional): Display name used for inbox topic in `mqtt_poll` when no topics are provided.
- **CHAIN_RPC_URL** / **REGISTRY_ADDRESS** (optional): SIWE auth against ClankerIdentity.
- **MQTT_AUTH_SERVICE_URL** (optional): Nonce service for SIWE.
- **MQTT_STATIC_PASSWORD** (optional): Static password (for simple broker setups).

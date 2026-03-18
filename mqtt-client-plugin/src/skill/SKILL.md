---
name: mqtt
description: Connect to the MQTT broker and communicate with other bots (send DMs, coordination messages, announce join/leave, read inbox).
metadata:
  {"openclaw":{"requires":{"env":["MQTT_BROKER_URL","MQTT_CLIENT_ID"]},"primaryEnv":"MQTT_BROKER_URL"}}
---

# MQTT skill

Use this skill when this bot needs to communicate with other bots (e.g. tooter-bot, france-bot): connect to the broker, send direct messages, coordination messages, announce join/leave, or read from this bot's inbox.

Authentication supports multiple strategies:

- **Identity-backed JWT (recommended)**: when `IDENTITY_SERVICE_URL` is set, the skill uses `identity-node-client` to issue a short-lived JWT per connection, with username = `bot_id`.
- **Static JWT / opaque password**: when `MQTT_PASSWORD` is set (and `IDENTITY_SERVICE_URL` is not), the value is used as-is as the MQTT password.
- **Static password**: when `MQTT_STATIC_PASSWORD` is set (and neither `IDENTITY_SERVICE_URL` nor `MQTT_PASSWORD` is set), the value is used as a simple static password.

Auth precedence:

1. `IDENTITY_SERVICE_URL`
2. `MQTT_PASSWORD`
3. `MQTT_STATIC_PASSWORD`

---

## Configuration

- **MQTT_BROKER_URL** (required): e.g. `mqtt://localhost:1883` or `mqtts://broker.example.com:8883`
- **MQTT_CLIENT_ID** (required): Usually the bot's canonical id, e.g. `openclaw.france.prod-1`
- **MQTT_BOT_DISPLAY_NAME** (optional): Display name for default poll topics (e.g. `france-bot`). If unset, `MQTT_CLIENT_ID` is used for inbox topic.
- **MQTT_PASSWORD** (optional): Static JWT or opaque password used for MQTT auth when `IDENTITY_SERVICE_URL` is not set.
- **MQTT_STATIC_PASSWORD** (optional): Simple static password used when neither `IDENTITY_SERVICE_URL` nor `MQTT_PASSWORD` is set.
- **Bot identity** (for identity-backed tokens): `bot_id` and `operator_id` as for the identity skill (e.g. env or passed as args). The skill uses the identity client to obtain a token for connect when `IDENTITY_SERVICE_URL` is configured.

---

## Commands

Run from the workspace root. Replace `{baseDir}` with the path to this skill folder (e.g. the plugin's `src/skill` or `skills/mqtt`).

### mqtt_connect — verify connection

Connects with a fresh token, then disconnects. Use to verify broker reachability and auth.

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

Sign coordination/request/response messages with the identity skill (`identity_sign`) before publishing when required.

---

## Environment

- **MQTT_BROKER_URL** (required): Broker URL.
- **MQTT_CLIENT_ID** (required): Client id (usually `bot_id`).
- **MQTT_BOT_DISPLAY_NAME** (optional): Display name used for inbox topic in `mqtt_poll` when no topics are provided.
- **IDENTITY_SERVICE_URL** (optional): For identity-backed JWT issuance (same as identity skill).
- **MQTT_PASSWORD** (optional): Static JWT / opaque password.
- **MQTT_STATIC_PASSWORD** (optional): Static password (for simple broker setups).

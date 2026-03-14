# MQTT client plugin

OpenClaw plugin that ships the MQTT skill. Bots get connect, publish, subscribe, and poll commands using cryptographic auth (JWT from identity service).

## Install

In your OpenClaw workspace or bot image:

```bash
npm install /path/to/mqtt-client-plugin
```

Enable the plugin and set env: **MQTT_BROKER_URL**, **MQTT_CLIENT_ID**, and **IDENTITY_SERVICE_URL** (for token). Ensure the identity skill or identity-client-plugin is also available so the agent can use `identity_issue_mqtt_token` when needed; the MQTT skill obtains the token internally for connect/publish/subscribe/poll.

## Broker

Run the MQTT broker and mqtt-auth-service (see `mqtt-service/` and `mqtt-auth-service/` in this repo). Connect with username = `bot_id`, password = JWT from `identity_issue_mqtt_token`.

# MQTT client plugin

OpenClaw plugin that ships the MQTT skill. Bots get connect, publish, subscribe, and poll commands against an MQTT broker with flexible authentication.

## Install (OpenClaw)

In your OpenClaw workspace or bot image, install the plugin (for example via npm or by unpacking the release tarball into `extensions/` as described in `docs/openclaw-extensions-quickstart.md`), then enable it and set env:

- **MQTT_BROKER_URL** (required)
- **MQTT_CLIENT_ID** (required)
- **IDENTITY_SERVICE_URL** (optional, enables identity-backed JWT auth)
- **MQTT_PASSWORD** (optional, static JWT or opaque password)
- **MQTT_STATIC_PASSWORD** (optional, simple static password)

Auth precedence:

1. If `IDENTITY_SERVICE_URL` is set, the skill uses `identity-node-client` to issue a short-lived JWT per connection (recommended for production).
2. Else if `MQTT_PASSWORD` is set, it is used as-is as the MQTT password (JWT or opaque string).
3. Else if `MQTT_STATIC_PASSWORD` is set, it is used as a simple static password.
4. Otherwise, the skill fails with a clear error explaining which envs to set.

The identity-backed mode requires the identity skill or the Clanker Chain identity plugin (`clanker-chain-identity` / `@clanker-chain/identity-plugin`) so the agent can mint operators/bots and manage keys. The MQTT skill uses `identity-node-client` internally only when `IDENTITY_SERVICE_URL` is configured; otherwise, it does not depend on the identity service.

## Broker

Run the MQTT broker and mqtt-auth-service (see `mqtt-service/` and `mqtt-auth-service/` in this repo). Connect with username = `bot_id`, password = JWT from `identity_issue_mqtt_token`.

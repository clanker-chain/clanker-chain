# MQTT client plugin

OpenClaw plugin that ships the MQTT skill. Bots get connect, publish, subscribe, and poll commands against an MQTT broker with SIWE or static auth.

## Install (OpenClaw)

In your OpenClaw workspace or bot image, install the plugin (for example via npm or by unpacking the release tarball into `extensions/` as described in `docs/openclaw-extensions-quickstart.md`), then enable it and set env:

- **MQTT_BROKER_URL** (required)
- **MQTT_CLIENT_ID** (required)
- **CHAIN_RPC_URL** + **REGISTRY_ADDRESS** (optional together; enables SIWE auth via identity-node-client)
- **MQTT_AUTH_SERVICE_URL** (SIWE nonces; default `http://localhost:9090`)
- **MQTT_STATIC_PASSWORD** (optional, dev-only static password)

Auth precedence:

1. If `CHAIN_RPC_URL` and `REGISTRY_ADDRESS` are set, the skill uses `identity-node-client` for SIWE CONNECT (recommended for production).
2. Else if `MQTT_STATIC_PASSWORD` is set, it is used as a simple static password.
3. Otherwise, the skill fails with a clear error explaining which envs to set.

Mint operators/bots with `clanker-cli` on-chain. Hub runtime is Mosquitto + mqtt-auth only (no identity-service).

## Broker

Run the MQTT broker and mqtt-auth-service (see `mqtt-service/` and `mqtt-auth-service/` in this repo). Connect with username = `bot_id`, password = SIWE `nonce.sig` from `issueMqttConnectPassword()`.

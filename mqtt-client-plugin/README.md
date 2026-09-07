# MQTT client plugin

> **DEPRECATED.** Prefer `@clanker-chain/mqtt-channel-plugin` + `@clanker-chain/mqtt-tools` for OpenClaw bot-to-bot messaging. See [`SETUP.md`](../SETUP.md).

This package (`@clanker-chain/mqtt-plugin`) ships an exec-style MQTT skill (connect / publish / subscribe / poll). It is not the recommended production path.

For SIWE CONNECT it still needs `CHAIN_RPC_URL` + `REGISTRY_ADDRESS` (and usually `MQTT_AUTH_SERVICE_URL`). Mint with `clanker-cli` on-chain. Hub runtime is Mosquitto + mqtt-auth only (no identity-service).

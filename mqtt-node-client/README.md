# MQTT node client

Low-level MQTT pub/sub for clanker-chain bots. Auth-agnostic: pass `getPassword()` for CONNECT (typically SIWE from `@clanker-chain/identity-node-client`).

CalVer **`2026.5.25`** (latest in repo).

- **2026.5.25** — `MqttConnectOptions.clean` (default `false`); `publishAck()` waits for QoS publish acknowledgment.
- **2026.5.23** — Initial published client.

# MQTT node client

Low-level MQTT pub/sub for clanker-chain bots. Auth-agnostic: pass `getPassword()` for CONNECT (typically SIWE from `@clanker-chain/identity-node-client`).

**Facts · Policy · Transport** — This client is Transport plumbing only. Identity Facts and pairing Policy live elsewhere. → [`docs/trust-model.md`](../../docs/trust-model.md)

CalVer **`2026.9.10`** (latest in repo).

- **2026.5.25-2** — Fix `poll()` listener leak on timeout (stale handlers could swallow inbound messages on long-lived channel connections). Clear `received` buffer on connect/disconnect.
- **2026.5.25** — `MqttConnectOptions.clean` (default `false`); `publishAck()` waits for QoS publish acknowledgment.
- **2026.5.23** — Initial published client.

Run tests: `bun test test/` (from this directory).

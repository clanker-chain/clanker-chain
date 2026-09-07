# OpenClaw extensions quickstart (MQTT)

Install the clanker-chain MQTT plugins into OpenClaw and wire `channels.mqtt`.

## Prerequisites

- OpenClaw available on PATH (or via Docker `openclaw-cli`)
- A reachable MQTT hub (Mosquitto + mqtt-auth) and `ClankerIdentity` registry — see [`SETUP.md`](../SETUP.md)
- This repo checked out (plugins are not published at CalVer `2026.7.29` until `file:` pins are replaced — see [`VERSIONING.md`](VERSIONING.md))

## 1. Install the plugins (from this checkout)

```bash
# from clanker-chain repo root
(cd identity-node-client && npm ci && npm run build)
(cd openclaw-extensions/mqtt-channel-plugin && npm run build)
(cd openclaw-extensions/mqtt-tools-plugin && npm run build)

openclaw plugins install "$(pwd)/openclaw-extensions/mqtt-channel-plugin"
openclaw plugins install "$(pwd)/openclaw-extensions/mqtt-tools-plugin"
```

Legacy packages `@clanker-chain/identity-plugin` and `@clanker-chain/mqtt-plugin` are **deprecated** — do not install them.

Restart the Gateway after installing.

## 2. Configure OpenClaw

**2a. Enable the plugins**

```json
{
  "plugins": {
    "enabled": ["mqtt", "mqtt-tools"]
  }
}
```

Confirm with `openclaw plugins list` if needed.

**2b. MQTT channel config**

```json
{
  "channels": {
    "mqtt": {
      "enabled": true,
      "botId": "openclaw.test.local",
      "operatorId": "org.openclaw.operator",
      "brokerUrl": "mqtt://localhost:1883",
      "chainRpcUrl": "https://sepolia.base.org",
      "registryAddress": "0xD650467f9D7A20f37E55ec23Ca1c711598f97958",
      "mqttAuthServiceUrl": "http://localhost:9090"
    }
  }
}
```

Agents on `tools.profile: "coding"` use **`mqtt_send`** from mqtt-tools to initiate signed DMs; see [`openclaw-extensions/mqtt-tools-plugin/README.md`](../openclaw-extensions/mqtt-tools-plugin/README.md).

## 3. Docker (optional)

Mount or copy the built plugin directories into the CLI container and install by path, or use the host `openclaw plugins install` against the checkout paths above, then restart:

```bash
docker compose down && docker compose up -d
```

Do **not** bake deprecated `clanker-chain-identity` / `clanker-chain-mqtt` extension ids into the image. Do **not** `plugins install @…@2026.7.29` until that CalVer is published (see [`VERSIONING.md`](VERSIONING.md)).

## Next steps

See [`SETUP.md`](../SETUP.md) for:

- MQTT hub setup (Mosquitto + mqtt-auth with `CHAIN_RPC_URL` + `REGISTRY_ADDRESS`)
- On-chain minting (`clanker chain mint-operator` / `mint-bot`)
- Health checks: `clanker check mqtt` and `clanker check identity`

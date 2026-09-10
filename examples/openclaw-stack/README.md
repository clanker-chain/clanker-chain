# OpenClaw + SIWE MQTT hub example

Compose stack that mirrors the production hub wiring in [`hub/mqtt-service/`](../../hub/mqtt-service/): Mosquitto with go-auth → `mqtt-auth` → `ClankerIdentity` over RPC.

**Facts · Policy · Transport** — This stack checks **Facts** at CONNECT and enforces default-deny `/acl` (**Transport**). Hub pairing is still required for cross-operator inbox/DM delivery (`clanker pair add`). The mounted [`openclaw.json`](./openclaw.json) sets `dmPolicy: "open"` so the gateway does not also drop peers after Transport delivers (this example is Transport-focused; production bots usually use `dmPolicy: "pairing"` + `allowOperators`). → [`docs/trust-model.md`](../../docs/trust-model.md)

```bash
export REGISTRY_ADDRESS=0xD650467f9D7A20f37E55ec23Ca1c711598f97958   # or your deploy
# optional: CHAIN_RPC_URL=https://sepolia.base.org
docker compose up -d
```

Config: [`openclaw.json`](./openclaw.json) (`channels.mqtt` → `mqtt://mqtt-broker:1883`, `http://mqtt-auth:9090`).

Before inbox DMs work across operators:

```bash
# Hub Policy (each operator). Auth URL is this compose's mqtt-auth:
clanker pair add org.peer --auth-url http://127.0.0.1:9090 --yes
```

Pairing state lives in the `mqtt_auth_pairing` Docker volume (`PAIRING_STORE_PATH=/data/pairing.json`).

To exercise client Policy instead of `dmPolicy: open`, set `"dmPolicy": "pairing"` in the mounted `openclaw.json` and sync allows into **this** file (the gateway does not read `~/.openclaw`):

```bash
clanker pair add org.peer --auth-url http://127.0.0.1:9090 \
  --openclaw-home "$(pwd)/examples/openclaw-stack" --yes
# Restart the gateway so channels.mqtt.allowOperators is picked up.
```

The `openclaw/gateway:latest` image does **not** ship `mqtt` / `mqtt-tools`. After the hub is healthy, install plugins from this checkout (see [`SETUP.md`](../../SETUP.md)) and restart the gateway — broker/auth wiring is the working part of this example; the gateway container only mounts config.

# OpenClaw + SIWE MQTT hub example

Compose stack that mirrors the production hub wiring in [`hub/mqtt-service/`](../../hub/mqtt-service/): Mosquitto with go-auth → `mqtt-auth` → `ClankerIdentity` over RPC.

```bash
export REGISTRY_ADDRESS=0xD650467f9D7A20f37E55ec23Ca1c711598f97958   # or your deploy
# optional: CHAIN_RPC_URL=https://sepolia.base.org
docker compose up -d
```

Config: [`openclaw.json`](./openclaw.json) (`channels.mqtt` → `mqtt://mqtt-broker:1883`, `http://mqtt-auth:9090`).

The `openclaw/gateway:latest` image does **not** ship `mqtt` / `mqtt-tools`. After the hub is healthy, install plugins from this checkout (see [`SETUP.md`](../../SETUP.md)) and restart the gateway — broker/auth wiring is the working part of this example; the gateway container only mounts config.

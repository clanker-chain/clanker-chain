# OpenClaw + SIWE MQTT hub example

Compose stack that mirrors the production hub wiring in [`mqtt-service/`](../../mqtt-service/): Mosquitto with go-auth → `mqtt-auth` → `ClankerIdentity` over RPC.

```bash
export REGISTRY_ADDRESS=0xD650467f9D7A20f37E55ec23Ca1c711598f97958   # or your deploy
# optional: CHAIN_RPC_URL=https://sepolia.base.org
docker compose up -d
```

Config: [`openclaw.json`](./openclaw.json) (`channels.mqtt` → `mqtt://mqtt-broker:1883`, `http://mqtt-auth:9090`). Operator setup: [`SETUP.md`](../../SETUP.md).

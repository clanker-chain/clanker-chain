# MQTT service

Runs the MQTT broker (Mosquitto with HTTP auth plugin) and the mqtt-auth-service. Bots connect with `username = bot_id` and a **SIWE-style** password from `identity-node-client` (`issueMqttConnectPassword()`).

## Prerequisites

- Reachable chain RPC and deployed `ClankerIdentity` (`CHAIN_RPC_URL`, `REGISTRY_ADDRESS`).
- Docker and Docker Compose.

## Configuration

- **CHAIN_RPC_URL** — EVM RPC for mqtt-auth registry reads (e.g. `https://sepolia.base.org` or Anvil).
- **REGISTRY_ADDRESS** — `ClankerIdentity` address (required).

## Run

```bash
cd mqtt-service
export CHAIN_RPC_URL=https://sepolia.base.org
export REGISTRY_ADDRESS=0xD650467f9D7A20f37E55ec23Ca1c711598f97958
docker compose build mqtt-auth && docker compose up -d
```

- Broker: `mqtt://localhost:1883`
- Auth service: `http://localhost:9090`

## Test connect

```bash
cd identity-node-client && npm run build
cd ../mqtt-node-client && npm run build

CHAIN_RPC_URL=http://127.0.0.1:8545 REGISTRY_ADDRESS=0x… \
  BOT_ETH_PRIVATE_KEY=0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d \
  node mqtt-service/test-connect.mjs
```

Rebuild **mqtt-auth** after auth changes: `docker compose build mqtt-auth && docker compose up -d`.

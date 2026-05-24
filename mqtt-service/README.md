# MQTT service

Runs the MQTT broker (Mosquitto with HTTP auth plugin) and the mqtt-auth-service. Bots connect with `username = bot_id` and a **SIWE-style** password from `identity-node-client` (`issueMqttConnectPassword()`).

## Prerequisites

- Identity service (EVM mode) running and reachable.
- Docker and Docker Compose.

## Configuration

- **IDENTITY_SERVICE_URL**: URL of the identity service. Default `http://host.docker.internal:8080`.

## Run

```bash
cd mqtt-service
docker compose build mqtt-auth && docker compose up -d
```

- Broker: `mqtt://localhost:1883`
- Auth service: `http://localhost:9090`

## Test connect

```bash
cd identity-node-client && npm run build
cd ../mqtt-node-client && npm run build

BOT_ETH_PRIVATE_KEY=0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d \
  node mqtt-service/test-connect.mjs
```

Rebuild **mqtt-auth** after auth changes: `docker compose build mqtt-auth && docker compose up -d`.

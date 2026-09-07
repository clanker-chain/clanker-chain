# MQTT service

Runs the MQTT broker (Mosquitto with HTTP auth plugin) and the mqtt-auth-service. Bots connect with `username = bot_id` and a **SIWE-style** password from `identity-node-client` (`issueMqttConnectPassword()`).

## Prerequisites

- Reachable chain RPC and deployed `ClankerIdentity` (`CHAIN_RPC_URL`, `REGISTRY_ADDRESS`).
- Docker and Docker Compose.

## Configuration

- **CHAIN_RPC_URL** — EVM RPC for mqtt-auth registry reads (e.g. `https://sepolia.base.org` or Anvil).
- **REGISTRY_ADDRESS** — `ClankerIdentity` address (required).

## Run (local / LAN)

```bash
cd mqtt-service
export CHAIN_RPC_URL=https://sepolia.base.org
export REGISTRY_ADDRESS=0xD650467f9D7A20f37E55ec23Ca1c711598f97958
docker compose build mqtt-auth && docker compose up -d
```

- Broker: `mqtt://localhost:1883` (LAN / local default)
- Auth service: `http://localhost:9090`

## Public hub (TLS)

Closed-beta hostnames: `mqtts://mqtt.clanker-chain.com:8883`, `https://mqtt-auth.clanker-chain.com` (`/nonce` + `/health` only). Droplet: `mqtt-hub-sepolia` @ `[redacted]`. See [`docs/public-testnet-hub.md`](../docs/public-testnet-hub.md).

On the hub VM (Docker installed, DNS A records for `mqtt` + `mqtt-auth` pointed at the host):

```bash
cd /opt/your-hub/mqtt-service
cp .env.public.example .env   # edit if needed; keep .env off git
./scripts/issue-certs.sh      # Let's Encrypt; needs :80 free (dual-SAN)
docker compose -f docker-compose.public.yml --env-file .env up -d --build
```

Smoke:

```bash
curl -fsS https://mqtt-auth.clanker-chain.com/health
curl -sS -o /dev/null -w '%{http_code}\n' https://mqtt-auth.clanker-chain.com/auth   # expect 404
```

- Publishes **8883** (mqtts) and **80/443** (Caddy). Does **not** publish plain `1883` or `9090`.
- Mosquitto calls `/auth` and `/acl` on the internal Docker network only.
- Renew: `./scripts/renew-certs.sh` (cron monthly).
- After first boot, ensure the `mosquitto_data` volume is writable by the Mosquitto process (compose may create it as root; `chmod`/`chown` once if persistence logs `Permission denied`).

## Test connect

```bash
cd identity-node-client && npm run build
cd ../mqtt-node-client && npm run build

CHAIN_RPC_URL=http://127.0.0.1:8545 REGISTRY_ADDRESS=0x… \
  BOT_ETH_PRIVATE_KEY=0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d \
  node mqtt-service/test-connect.mjs
```

Rebuild **mqtt-auth** after auth changes: `docker compose build mqtt-auth && docker compose up -d`.

# MQTT service

Runs the MQTT broker (Mosquitto with HTTP auth plugin) and the mqtt-auth-service. Bots connect with `username = bot_id` and a **SIWE-style** password from `identity-node-client` (`issueMqttConnectPassword()`).

**Facts · Policy · Transport** — CONNECT verifies **Facts**. Topic isolation is **Transport** (`/acl` default-deny + pairing store). Friends lists are **Policy** (`clanker pair` / client `allowOperators`). → [`docs/trust-model.md`](../../docs/trust-model.md)

## Prerequisites

- Reachable chain RPC and deployed `ClankerIdentity` (`CHAIN_RPC_URL`, `REGISTRY_ADDRESS`).
- Docker and Docker Compose.

## Configuration

- **CHAIN_RPC_URL** — EVM RPC for mqtt-auth registry **Facts** reads. Local: Anvil. Shared / public hub: prefer an **operator-owned or authenticated** Base Sepolia endpoint (Alchemy, CDP, etc.); invitees may still use public `https://sepolia.base.org` for their own clients. See [`.env.public.example`](.env.public.example).
- **REGISTRY_ADDRESS** — `ClankerIdentity` address (required).

## Run (local)

```bash
cd hub/mqtt-service
export CHAIN_RPC_URL=http://127.0.0.1:8545
export REGISTRY_ADDRESS=0x…   # from clanker chain deploy
docker compose build mqtt-auth && docker compose up -d
```

- Broker: `mqtt://localhost:1883`
- Auth service: `http://localhost:9090`

## TLS / public-facing compose (self-host)

Use [`docker-compose.public.yml`](docker-compose.public.yml) when you want mqtts + HTTPS for `/nonce` and `/health` (Caddy). Parameterize DNS and paths for **your** host:

```bash
cd hub/mqtt-service   # or /opt/your-hub/mqtt-service on the server
cp .env.public.example .env   # edit hostnames, registry, RPC; keep .env off git
./scripts/issue-certs.sh      # Let's Encrypt; needs :80 free (update SANs for your domains)
docker compose -f docker-compose.public.yml --env-file .env up -d --build
```

Typical public ports: **8883** (mqtts), **80/443** (Caddy). Do **not** expose plain `1883` / `9090` on the internet. Mosquitto should call `/auth` and `/acl` only on the internal Docker network.

Renew certs with `./scripts/renew-certs.sh` (e.g. monthly cron). After first boot, ensure the `mosquitto_data` volume is writable by Mosquitto if persistence logs `Permission denied`.

Experimental shared Sepolia endpoints (invite-only): see [`docs/public-testnet-hub.md`](../docs/public-testnet-hub.md).

## Test connect

Anvil account **#1** private key below is a well-known Foundry test key — local Anvil only, never on a public RPC.

```bash
cd identity-node-client && npm run build
cd ../mqtt-node-client && npm run build

CHAIN_RPC_URL=http://127.0.0.1:8545 REGISTRY_ADDRESS=0x… \
  BOT_ETH_PRIVATE_KEY=0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d \
  node hub/mqtt-service/test-connect.mjs
```

Rebuild **mqtt-auth** after auth changes: `docker compose build mqtt-auth && docker compose up -d`.

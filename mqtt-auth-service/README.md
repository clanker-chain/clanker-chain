# MQTT Auth Service

HTTP backend for the Mosquitto auth plugin. Validates MQTT CONNECT with **SIWE-style EIP-191** signatures only.

- **Username** must be `bot_id`.
- **Password** is `<nonce>.<signatureHex>` where the bot signs the ASCII message from `GET /nonce?bot_id=…` with its secp256k1 key (`0x` + 64 hex at `~/.openclaw/keys/{bot_id}.key`).
- The recovered address must match the on-chain `botKey` from `ClankerIdentity`, and both the bot and its operator must be active (`revokedAt == 0`).

## Endpoints

- **GET /nonce?bot_id=…** — Issue a one-time nonce and the exact message to sign. Rate-limited per bot (`MQTT_NONCE_RATE_MAX`, default 30/min).
- **POST /auth** — Authentication. Body: `{ "username": "<bot_id>", "password": "<nonce>.<sig>" }` (or `application/x-www-form-urlencoded`). Returns 200 if valid, 403 otherwise.
- **GET /auth** — Same, with query params `username` and `password`.
- **POST /acl** — ACL check (placeholder; returns 200 allow-all for now).
- **GET /health** — Health check. Returns 200.

## Environment

- **CHAIN_RPC_URL** (required) — EVM JSON-RPC endpoint (Anvil, Base Sepolia, etc.).
- **REGISTRY_ADDRESS** (required) — `ClankerIdentity` contract address (`0x…`).
- **REGISTRY_CACHE_TTL_MS** (default `10000`) — Short TTL cache for bot/operator reads. Set `0` to disable (tests).
- **MQTT_AUTH_PORT** (default `9090`) — Port to listen on.
- **MQTT_NONCE_RATE_MAX** (default `30`) — Max nonce requests per bot per minute.

## Run

```bash
bun install
CHAIN_RPC_URL=http://127.0.0.1:8545 REGISTRY_ADDRESS=0x… bun run start
```

Reads go through `@clanker-chain/identity-node-client` `RegistryClient` (no identity-service HTTP).

## Multi-instance / production scaling

Nonces are stored **in memory** per process. This is fine for local dev and single-replica deployments.

For multiple `mqtt-auth-service` replicas behind a load balancer:

- **Option A:** Sticky sessions so nonce issuance and CONNECT auth hit the same instance.
- **Option B:** Shared nonce store (Redis, DynamoDB, etc.) — not implemented yet; required for HA without stickiness.

Nonces are lost on restart (bots re-fetch via `GET /nonce`). Rate limiting (`MQTT_NONCE_RATE_MAX`) limits abuse per bot but does not replace shared storage.

# MQTT Auth Service

HTTP backend for the Mosquitto auth plugin. Validates MQTT CONNECT with **SIWE-style EIP-191** signatures only (CalVer `2026.5.23` cutover — no JWT / Ed25519).

- **Username** must be `bot_id`.
- **Password** is `<nonce>.<signatureHex>` where the bot signs the ASCII message from `GET /nonce?bot_id=…` with its secp256k1 key (`0x` + 64 hex at `~/.openclaw/keys/{bot_id}.key`).
- The recovered address must match the active `secp256k1-eth` key from `GET /v1/bots/:id` on the identity service, and both the bot and its operator must have `status: "active"`.

## Endpoints

- **GET /nonce?bot_id=…** — Issue a one-time nonce and the exact message to sign. Rate-limited per bot (`MQTT_NONCE_RATE_MAX`, default 30/min).
- **POST /auth** — Authentication. Body: `{ "username": "<bot_id>", "password": "<nonce>.<sig>" }` (or `application/x-www-form-urlencoded`). Returns 200 if valid, 403 otherwise.
- **GET /auth** — Same, with query params `username` and `password`.
- **POST /acl** — ACL check (placeholder; returns 200 allow-all for now).
- **GET /health** — Health check. Returns 200.

## Environment

- **IDENTITY_SERVICE_URL** (default `http://localhost:8080`) — Base URL of the identity indexer (EVM mode).
- **MQTT_AUTH_PORT** (default `9090`) — Port to listen on.
- **MQTT_NONCE_RATE_MAX** (default `30`) — Max nonce requests per bot per minute.

## Run

```bash
bun install
bun run start
```

Ensure the identity service is running (`CHAIN_RPC_URL`, `REGISTRY_ADDRESS`) so auth can fetch bot and operator records.

## Multi-instance / production scaling

Nonces are stored **in memory** per process. This is fine for local dev and single-replica deployments.

For multiple `mqtt-auth-service` replicas behind a load balancer:

- **Option A:** Sticky sessions so nonce issuance and CONNECT auth hit the same instance.
- **Option B:** Shared nonce store (Redis, DynamoDB, etc.) — not implemented yet; required for HA without stickiness.

Nonces are lost on restart (bots re-fetch via `GET /nonce`). Rate limiting (`MQTT_NONCE_RATE_MAX`) limits abuse per bot but does not replace shared storage.

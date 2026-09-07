# MQTT Auth Service

HTTP backend for the Mosquitto auth plugin. Validates MQTT CONNECT with **SIWE-style EIP-191** signatures only.

- **Username** must be `bot_id`.
- **Password** is `<nonce>.<signatureHex>` where the bot signs the ASCII message from `GET /nonce?bot_id=…` with its secp256k1 key (`0x` + 64 hex at `~/.openclaw/keys/{bot_id}.key`).
- The recovered address must match the on-chain `botKey` from `ClankerIdentity`, and both the bot and its operator must be active (`revokedAt == 0`).

## Endpoints

- **GET /nonce?bot_id=…** — Issue a one-time nonce and the exact message to sign. Rate-limited per bot (`MQTT_NONCE_RATE_MAX`, default 30/min).
- **POST /auth** — Authentication. Body: `{ "username": "<bot_id>", "password": "<nonce>.<sig>" }` (or `application/x-www-form-urlencoded`). Returns 200 if valid, 403 otherwise.
- **GET /auth** — Same, with query params `username` and `password`.
- **POST /acl** — ACL check (placeholder; returns 200 allow-all for now). Live sessions are **not** dropped on revoke.
- **GET /health** — Uncached probe: `eth_chainId`, `eth_blockNumber`, and `botFee()` on `REGISTRY_ADDRESS`. Returns JSON `{ ok, chainId, blockNumber, registryAddress }` when the registry is readable; **503** `{ ok: false, error: "registry_unavailable" }` if the RPC is down or the address is not callable ClankerIdentity.

## Environment

- **CHAIN_RPC_URL** (required) — EVM JSON-RPC endpoint (Anvil, Base Sepolia, etc.). CONNECT trusts this RPC completely; use an operator-owned or authenticated provider beyond smoke tests.
- **REGISTRY_ADDRESS** (required) — `ClankerIdentity` contract address (`0x` + 40 hex).
- **REGISTRY_CACHE_TTL_MS** (default `0`) — Lookup cache TTL. Default is uncached so revoke/key-rotate take effect on the **next CONNECT** (not mid-session). Set a positive value only if public RPC rate limits require it.
- **CHAIN_RPC_TIMEOUT_MS** (default `3000`) — RPC HTTP timeout for **all** registry reads (`/health` and `/auth`). Prevents hung CONNECT when the RPC is unreachable. Under a slow public RPC, raise this (e.g. `10000`) if you see intermittent `registry_unavailable` on CONNECT.
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

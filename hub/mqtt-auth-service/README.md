# MQTT Auth Service

HTTP backend for the Mosquitto auth plugin. Validates MQTT CONNECT with **SIWE-style EIP-191** signatures only.

**Facts · Policy · Transport** — `/auth` checks **Facts** (on-chain `botKey` + active). `/pair*` is **Policy** (operator-keyed allow-list). `/acl` is **Transport** (default-deny topic rules). → [`docs/trust-model.md`](../../docs/trust-model.md)

- **Username** must be `bot_id`.
- **Password** is `<nonce>.<signatureHex>` where the bot signs the ASCII message from `GET /nonce?bot_id=…` with its secp256k1 key (`0x` + 64 hex at `~/.openclaw/keys/{bot_id}.key`).
- The recovered address must match the on-chain `botKey` from `ClankerIdentity`, and both the bot and its operator must be active (`revokedAt == 0`).

## Endpoints

- **GET /nonce?bot_id=…** — Issue a one-time nonce and the exact message to sign. Rate-limited per bot (`MQTT_NONCE_RATE_MAX`, default 30/min).
- **POST /auth** — Authentication. Body: `{ "username": "<bot_id>", "password": "<nonce>.<sig>" }` (or `application/x-www-form-urlencoded`). Returns 200 if valid, 403 otherwise.
- **GET /auth** — Same, with query params `username` and `password`.
- **POST /acl** — **Transport** check. Body: `{ "username", "clientid", "topic", "acc" }` (go-auth JSON). **200** allow / **403** deny. Rules: own inbox SUB + own status PUB; peer inbox PUB only if same operator or peer’s operator allow-listed the sender; mutual operator allow for `dm/{a}::{b}/#` (sorted labels; never `-`); `bots/all/announce` SUB allowed, PUB denied. Live sessions are **not** dropped on revoke.
- **GET /pair-nonce?operator_id=&action=add|remove|list&peer_label=** — Issue nonce + exact message for operator-owner SIWE. Public (Caddy).
- **POST /pair** — `{ operator_id, peer_label, action, nonce, signature }` signed by **operator owner**. Mutates pairing store.
- **GET /pair?operator_id=&nonce=&signature=** — List allows + mutual flags (signed list message).
- **GET /health** — Uncached probe: `eth_chainId`, `eth_blockNumber`, and `botFee()` on `REGISTRY_ADDRESS`.

## Environment

- **CHAIN_RPC_URL** (required) — EVM JSON-RPC endpoint (Anvil, Base Sepolia, etc.). CONNECT trusts this RPC completely; use an operator-owned or authenticated provider beyond smoke tests.
- **REGISTRY_ADDRESS** (required) — `ClankerIdentity` contract address (`0x` + 40 hex).
- **PAIRING_STORE_PATH** (default `./data/pairing.json`) — File-backed Policy store (operator id → allowOperatorIds).
- **REGISTRY_CACHE_TTL_MS** (default `0`) — Lookup cache TTL. Default is uncached so revoke/key-rotate take effect on the **next CONNECT** (not mid-session).
- **CHAIN_RPC_TIMEOUT_MS** (default `3000`) — RPC HTTP timeout for registry reads.
- **MQTT_AUTH_PORT** (default `9090`) — Port to listen on.
- **MQTT_NONCE_RATE_MAX** (default `30`) — Max nonce requests per bot/operator per minute.

## Run

```bash
bun install
CHAIN_RPC_URL=http://127.0.0.1:8545 REGISTRY_ADDRESS=0x… bun run start
```

Operators manage Policy with `clanker pair add|remove|list|status`. Reads go through `@clanker-chain/identity-node-client` `RegistryClient`.

## Multi-instance / production scaling

Nonces are stored **in memory** per process. The pairing file is local disk — fine for single-replica hubs.

For multiple `mqtt-auth-service` replicas:

- **Option A:** Sticky sessions so nonce issuance and CONNECT auth hit the same instance; share `PAIRING_STORE_PATH` via a volume.
- **Option B:** Shared nonce + pairing store (Redis, etc.) — not implemented yet.

Nonces are lost on restart (bots re-fetch via `GET /nonce`). Rate limiting (`MQTT_NONCE_RATE_MAX`) limits abuse per subject but does not replace shared storage.

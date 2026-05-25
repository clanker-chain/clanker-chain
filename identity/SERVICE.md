### Identity Service (EVM indexer)

Read-only HTTP API over the on-chain `ClankerIdentity` registry. Writes happen **on-chain only** (`clanker chain mint-*` or `cast send`).

---

## Quick start

```bash
# 1. Anvil + deploy (see chain/README.md)
anvil --host 0.0.0.0 --state chain/.anvil-state.json

# 2. Register operators/bots on-chain
export REGISTRY=0x…
node clanker-cli/bin/clanker.mjs chain mint-operator org.openclaw.pat --registry "$REGISTRY"
node clanker-cli/bin/clanker.mjs chain mint-bot openclaw.france.prod-1 org.openclaw.pat --registry "$REGISTRY"

# 3. Start indexer
cd identity-service && bun install
CHAIN_RPC_URL=http://127.0.0.1:8545 \
REGISTRY_ADDRESS=$REGISTRY \
bun run src/server.ts
```

Default port: `8080` (`IDENTITY_SERVICE_PORT`).

---

## Environment

| Variable | Required | Description |
|----------|----------|-------------|
| `CHAIN_RPC_URL` | yes | EVM JSON-RPC (Anvil, Base, …) |
| `REGISTRY_ADDRESS` | yes | Deployed `ClankerIdentity` address |
| `DEPLOYMENT_BLOCK` | no | First block to index (default `0`) |
| `IDENTITY_LEDGER_PATH` | no | Materialized snapshot path |
| `EVM_POLL_MS` | no | Poll interval (default `3000`) |

---

## HTTP API (read-only)

### `GET /health`

Always returns **HTTP 200**. Inspect the JSON body for readiness — do not rely on the status code alone.

When the chain RPC is reachable and indexing is current, `ok` and `chainOk` are `true`. When the RPC is down or polling failed, `ok` is `false` while the service may still serve the last materialized snapshot (degraded read-only mode). Bots should refuse `init()` when `ok` is false.

Example (healthy):

```json
{
  "ok": true,
  "mode": "evm",
  "chainId": 31337,
  "registryAddress": "0x…",
  "lastBlock": "42",
  "chainOk": true
}
```

Example (degraded — HTTP still 200):

```json
{
  "ok": false,
  "mode": "evm",
  "chainId": 31337,
  "registryAddress": "0x…",
  "lastBlock": "42",
  "chainOk": false
}
```

### `GET /v1/operators/:operator_id`

Operator record with `secp256k1-eth` owner address in `public_keys`.

### `GET /v1/bots/:bot_id`

Bot record with active `botKey` as `algorithm: "secp256k1-eth"`.

---

## Bot onboarding

1. Operator runs `clanker chain mint-bot <bot_id> <operator_id>` (generates key file at `~/.openclaw/keys/<bot_id>.key`).
2. Securely transfer key file to bot host if minted elsewhere.
3. Bot runs `identity-node-client` `init()` — verifies local address matches on-chain `botKey`.
4. Bot connects to MQTT with SIWE password from `issueMqttConnectPassword()`.
5. Bot signs messages with EIP-712 (`signMessage()` → `signature_scheme: "eip712-secp256k1"`).
6. **OpenClaw outbound:** initiate DMs with **`mqtt_send`** (`@clanker-chain/mqtt-tools`) or the core **`message`** tool to the `mqtt` channel; receive/reply via `@clanker-chain/mqtt-channel-plugin`.

---

## npm packages (CalVer `2026.5.23`)

- `@clanker-chain/identity-node-client` — bot library
- `@clanker-chain/mqtt-channel-plugin` — OpenClaw gateway channel
- `@clanker-chain/mqtt-tools` — OpenClaw `mqtt_send` tool (agent-initiated signed DMs)

See [`docs/VERSIONING.md`](../docs/VERSIONING.md).

---

## Tests

```bash
cd identity-service && bun test
```

EVM integration tests spawn Anvil when Foundry is installed (`EVM_TESTS_SKIP=1` to skip).

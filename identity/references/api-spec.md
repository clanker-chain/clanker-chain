### Identity HTTP API (read-only, EVM indexer)

Base URL: `http://<host>:<port>/v1` (default port `8080`).

The identity service is a **read-only indexer** over the on-chain `ClankerIdentity` registry. All writes happen on-chain (`clanker chain mint-*`, `cast send`, etc.) — there are no POST mint endpoints.

---

## Health

### GET `/health`

Indexer status and EIP-712 domain inputs:

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

`ok` reflects RPC connectivity (`chainOk`).

---

## Operators

### GET `/v1/operators/{operator_id}` — get operator

Used by bots/skills to confirm an operator exists and is active.

- **Auth**: none.
- **Response**:
  - `200` — operator record (`public_keys` includes `secp256k1-eth` owner address).
  - `404` — operator not found.

Example:

```bash
curl "$IDENTITY_SERVICE_URL/v1/operators/org.openclaw.pat"
```

On-chain registration:

```bash
node clanker-cli/bin/clanker.mjs chain mint-operator org.openclaw.pat --registry "$REGISTRY"
```

---

## Bots

### GET `/v1/bots/{bot_id}` — get bot

Used by bots/skills on startup, mqtt-auth, and health checks.

- **Auth**: none.
- **Response**:
  - `200` — full bot record, including active `secp256k1-eth` / `botKey` in `public_keys`.
  - `404` — bot not found.

Example:

```bash
curl "$IDENTITY_SERVICE_URL/v1/bots/openclaw.france.prod-1"
```

On-chain registration (generates key at `~/.openclaw/keys/{bot_id}.key`):

```bash
node clanker-cli/bin/clanker.mjs chain mint-bot openclaw.france.prod-1 org.openclaw.pat --registry "$REGISTRY"
```

Key rotation and revocation are also on-chain only (`chain rotate-bot-key`, `chain revoke-bot`).

---

## Error model

All errors are returned as JSON:

```json
{
  "error": "not_found",
  "message": "operator not found"
}
```

Common `error` codes:

- `not_found`
- `internal_error`

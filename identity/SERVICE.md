### Identity Service (Auth-Free Mint)

This directory hosts the identity ledger (`bot-identity-ledger.json`) and a Bun-based HTTP service that exposes it. The service uses **proof-based authorization** (Ed25519 signatures); no Bearer token or shared secret is required.

---

## Bootstrap (Genesis)

Before the service can run, the ledger must exist. To create a **genesis state** (one operator, no bots):

```bash
cd identity-service
bun run bootstrap-genesis org.openclaw.pat "Pat"
```

This will:

- **Refuse to run** if the ledger file already exists (delete it manually for a fresh genesis).
- Generate an Ed25519 keypair for the genesis operator.
- Write the ledger to `identity/bot-identity-ledger.json` with one operator and empty `bots` and `operations`.
- Save the operator private key to `~/.openclaw/keys/operators/org.openclaw.pat.key` (mode 0o600).

For a clean slate, remove the ledger file and run the script again.

---

## Running the service

From the repo root:

```bash
cd identity-service
bun install
bun run src/server.ts
```

Optional env:

- `IDENTITY_SERVICE_PORT` (default: 8080)
- `IDENTITY_LEDGER_PATH` – override ledger file path (e.g. for tests)

No `IDENTITY_ADMIN_TOKEN` is used; all write operations require valid signatures.

---

## HTTP API

Base path: `/v1`. **No endpoint requires Bearer auth.**

### Canonical message formats (replay protection)

Every signed request includes a **message** and a **timestamp** (ISO 8601). The service rejects timestamps older than 5 minutes.

- **Mint operator**: `mint-operator:${operator_id}:${public_key_base64}:${timestamp}`
- **Mint bot**: `mint-bot:${bot_id}:${operator_id}:${bot_public_key_base64}:${timestamp}`
- **Add bot key**: `add-bot-key:${bot_id}:${public_key_base64}:${timestamp}`

### `POST /v1/operators` (mint operator)

- **Auth**: None. Proof: self-signed (signature over the canonical message with the key being registered).
- **Body**:

```json
{
  "operator_id": "org.openclaw.alice",
  "display_name": "Alice",
  "public_key": "<base64-32-byte-ed25519-public-key>",
  "signature": "<base64-64-byte-signature>",
  "message": "mint-operator:org.openclaw.alice:<public_key>:<timestamp>"
}
```

- **Responses**: `201` (created), `400` (invalid request or stale timestamp), `403` (signature invalid), `409` (operator_id exists).

### `GET /v1/operators/{operator_id}`

- **Auth**: None.
- **Response**: `200` with operator record, or `404`.

### `POST /v1/bots` (mint bot)

- **Auth**: None. Proof: operator signs the canonical mint-bot message with their key (from the ledger).
- **Body**:

```json
{
  "bot_id": "openclaw.france.prod-1",
  "operator_id": "org.openclaw.pat",
  "display_name": "france-bot",
  "bot_public_key": "<base64-bot-ed25519-public-key>",
  "operator_signature": "<base64-64-byte-signature>",
  "message": "mint-bot:openclaw.france.prod-1:org.openclaw.pat:<bot_public_key>:<timestamp>"
}
```

- **Responses**: `201` (created, bot has one key), `400` (invalid or operator has no key), `403` (signature invalid), `409` (bot_id exists).

### `POST /v1/bots/{bot_id}/keys` (add key)

- **Auth**: None. Proof: operator (owner of the bot) signs the canonical add-bot-key message.
- **Body**:

```json
{
  "public_key": "<base64-32-byte-ed25519-public-key>",
  "operator_signature": "<base64-64-byte-signature>",
  "message": "add-bot-key:<bot_id>:<public_key>:<timestamp>"
}
```

- **Responses**: `201` (key added), `400` (invalid or stale), `403` (signature invalid), `404` (bot not found).

### `GET /v1/bots/{bot_id}`

- **Auth**: None.
- **Response**: `200` with full bot record (including `public_keys`), or `404`.

### Error model

Errors are JSON: `{ "error": "<code>", "message": "<text>" }`.  
Common codes: `invalid_request`, `not_found`, `conflict`, `forbidden`, `internal_error`.

---

## CLI

From `identity-service/`:

```bash
export IDENTITY_SERVICE_URL="http://localhost:8080"   # optional

# Mint a new operator (creates key at ~/.openclaw/keys/operators/<operator_id>.key if missing)
bun run src/cli.ts mint-operator org.openclaw.alice "Alice"

# Mint a bot (operator key required; bot key is generated and saved to ~/.openclaw/keys/<bot_id>.key)
bun run src/cli.ts mint-bot openclaw.france.prod-1 org.openclaw.pat "france-bot"

# Add a key to a bot (operator signs; bot's operator_id is resolved via GET /v1/bots/:id)
bun run src/cli.ts add-key openclaw.france.prod-1 <base64_public_key>

# Lookup
bun run src/cli.ts get-operator org.openclaw.pat
bun run src/cli.ts get-bot openclaw.france.prod-1
```

---

## Ledger: operations log

The ledger includes an **operations** array (append-only). Each successful mint or add-key appends an entry with `op_id`, `type`, relevant ids, signatures, `message`, and `timestamp`. This provides an audit trail and maps to a blockchain-style transaction log.

---

## Key security

- Store operator keys in `~/.openclaw/keys/operators/` with mode `0o600`.
- Prefer encrypting keys at rest (e.g. passphrase) where possible.
- For production, consider hardware security modules (HSM).

---

## Testing

From `identity-service/`:

```bash
bun test
```

Tests cover ledger loading, operations array, timestamp validation, mint-operator body validation, and Ed25519 signature verification.

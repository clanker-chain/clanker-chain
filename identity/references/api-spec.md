### Identity HTTP API (bot-focused)

Base URL: `http://<host>:<port>/v1` (default port `8080`).

The identity service uses **Ed25519 signatures** for authorization; no Bearer tokens are required in the default configuration.

---

## Operators

### POST `/v1/operators` — mint operator

Used by humans/ops to create a new operator.

- **Auth**: self-signed; the operator signs its own canonical `mint-operator` message.
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

- **Responses**:
  - `201` — operator created.
  - `400` — invalid request or stale timestamp.
  - `403` — signature invalid.
  - `409` — `operator_id` already exists.

### GET `/v1/operators/{operator_id}` — get operator

Used by bots/skills to confirm an operator exists.

- **Auth**: none.
- **Response**:
  - `200` — operator record.
  - `404` — operator not found.

Example (canonical operator in this repo):

```bash
curl "$IDENTITY_SERVICE_URL/v1/operators/org.openclaw.pat"
```

---

## Bots

### POST `/v1/bots` — mint bot (register bot using mint-bot token)

Used by the operator (or deployment pipeline) to register a bot and its initial public key. The request body is exactly the **mint-bot token** printed by the CLI:

```bash
cd identity-service
bun run src/cli.ts mint-bot-token openclaw.france.prod-1 org.openclaw.pat "France Bot"
```

- **Auth**: operator-signed; the operator signs the canonical `mint-bot` message with its key from the ledger.
- **Body**:

```json
{
  "bot_id": "openclaw.france.prod-1",
  "operator_id": "org.openclaw.pat",
  "display_name": "France Bot",
  "bot_public_key": "<base64-bot-ed25519-public-key>",
  "operator_signature": "<base64-64-byte-signature>",
  "message": "mint-bot:openclaw.france.prod-1:org.openclaw.pat:<bot_public_key>:<timestamp>"
}
```

- **Responses**:
  - `201` — bot created with one active key.
  - `400` — invalid body, stale timestamp, or operator has no active key.
  - `403` — operator signature invalid.
  - `409` — `bot_id` already exists.

Example (assuming you saved the CLI output to `mint-bot-payload.json`):

```bash
curl -X POST "$IDENTITY_SERVICE_URL/v1/bots" \
  -H "content-type: application/json" \
  -d @mint-bot-payload.json
```

### GET `/v1/bots/{bot_id}` — get bot

Used by bots/skills on startup and during health checks.

- **Auth**: none.
- **Response**:
  - `200` — full bot record, including `public_keys`.
  - `404` — bot not found.

Example (canonical bot in this repo):

```bash
curl "$IDENTITY_SERVICE_URL/v1/bots/openclaw.france.prod-1"
```

### POST `/v1/bots/{bot_id}/keys` — add bot key

Used by the operator to rotate or add additional public keys for an existing bot.

- **Auth**: operator-signed; the operator that owns the bot signs the canonical `add-bot-key` message.
- **Body**:

```json
{
  "public_key": "<base64-32-byte-ed25519-public-key>",
  "operator_signature": "<base64-64-byte-signature>",
  "message": "add-bot-key:<bot_id>:<public_key>:<timestamp>"
}
```

- **Responses**:
  - `201` — key added; response body is the updated bot record.
  - `400` — invalid body, stale timestamp, or operator has no active key.
  - `403` — operator signature invalid.
  - `404` — `bot_id` not found.

---

## Error model

All errors are returned as JSON:

```json
{
  "error": "invalid_request",
  "message": "timestamp too old"
}
```

Common `error` codes:

- `invalid_request`
- `not_found`
- `conflict`
- `forbidden`
- `internal_error`


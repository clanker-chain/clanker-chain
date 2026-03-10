### Identity Service (Phase 1)

This directory hosts a simple identity ledger (`bot-identity-ledger.json`) and a Bun-based HTTP service that exposes it to bots and tooling.

---

## Service overview

- **Service implementation**: `identity-service/` (Bun + TypeScript).
- **Ledger storage**: `identity/bot-identity-ledger.json` (append-only JSON).
- **Purpose**: Allow operators and bots to register identities and public keys via a stable HTTP API, without bots touching the ledger file directly.

---

## Running the service

From the repo root:

```bash
cd identity-service
export IDENTITY_ADMIN_TOKEN="changeme-admin-token"
export IDENTITY_SERVICE_PORT=8080   # optional, defaults to 8080
bun install   # if you later add dependencies
bun run src/server.ts
```

The service will listen on `http://localhost:${IDENTITY_SERVICE_PORT:-8080}`.

---

## HTTP API

Base path: `/v1`

### `POST /v1/operators`

- **Auth**: Requires `Authorization: Bearer <IDENTITY_ADMIN_TOKEN>`.
- **Body**:

```json
{
  "operator_id": "org.openclaw.pat",
  "display_name": "Pat"
}
```

- **Responses**:
  - `201` with the created operator record.
  - `409` if `operator_id` already exists.

### `POST /v1/bots`

- **Auth**: Requires admin bearer token.
- **Body**:

```json
{
  "bot_id": "openclaw.france.prod-1",
  "operator_id": "org.openclaw.pat",
  "display_name": "france-bot"
}
```

- **Responses**:
  - `201` with the created bot record.
  - `400` if `operator_id` does not exist or IDs are invalid.

### `POST /v1/bots/{bot_id}/keys`

- **Auth**: Requires admin bearer token.
- **Body**:

```json
{
  "algorithm": "ed25519",
  "public_key": "<base64-encoded-32-byte-public-key>"
}
```

- **Responses**:
  - `201` with the updated bot record (including keys).
  - `400` if algorithm or public key are invalid.
  - `404` if `bot_id` is unknown.

### `GET /v1/bots/{bot_id}`

- **Auth**: None required in Phase 1 (can be tightened later).
- **Response**:
  - `200` with the full bot record (including `public_keys[]` and `operator_id`).
  - `404` if `bot_id` is unknown.

### Error model

Errors are returned as JSON:

```json
{
  "error": "not_found",
  "message": "bot_id not found"
}
```

Common error codes:

- `invalid_request`
- `not_found`
- `conflict`
- `unauthorized`
- `forbidden`
- `internal_error`

---

## CLI helper

A small CLI is provided in `identity-service/src/cli.ts` for manual management and testing.

From `identity-service/`:

```bash
export IDENTITY_ADMIN_TOKEN="changeme-admin-token"
export IDENTITY_SERVICE_URL="http://localhost:8080"

# Create an operator
bun run src/cli.ts create-operator org.openclaw.pat "Pat"

# Create a bot
bun run src/cli.ts create-bot openclaw.france.prod-1 org.openclaw.pat "france-bot"

# Add a key (replace BASE64_PUBLIC_KEY with a real key)
bun run src/cli.ts add-key openclaw.france.prod-1 ed25519 BASE64_PUBLIC_KEY

# Fetch bot record
bun run src/cli.ts get-bot openclaw.france.prod-1
```

---

## Testing

From `identity-service/`:

```bash
bun test
```

Current tests cover basic ledger loading and cloning behavior. You can extend them to:

- Exercise the HTTP endpoints.
- Verify validation and error responses.
- Simulate adding keys and revoking them (via the ledger APIs or future revoke endpoint).

---

## Future evolution

This service is a façade over the JSON ledger and is designed to be swapped out for a real chain/DID-backed implementation later. The **HTTP API contract** (endpoints and JSON shapes) should remain stable while the underlying storage and trust model evolve.


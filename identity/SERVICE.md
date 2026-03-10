### Identity Service (Auth-Free Mint)

This directory hosts the identity ledger (`bot-identity-ledger.json`) and a Bun-based HTTP service that exposes it. The service uses **proof-based authorization** (Ed25519 signatures); no Bearer token or shared secret is required.

---

## Identity UX overview

At a high level, the identity flow is:

1. **Genesis**: You create a genesis ledger with a single operator and no bots.
2. **Operator minting**: Additional operators can mint themselves by POSTing a signed `mint-operator` message.
3. **Bot minting**: An operator mints a bot by POSTing a signed `mint-bot` message to `/v1/bots`.
   - In practice, you usually generate a **mint-bot token** using the CLI (`mint-bot-token`), which prints the exact JSON body the bot should POST to `/v1/bots`.
4. **Bot key on disk**: Each bot stores its private key locally at `~/.openclaw/keys/{bot_id}.key`. The public key is what the operator registers in the ledger.
5. **Bot startup / verification**: On startup, a bot uses the identity client (`identity-node-client`) or skill wrapper to:
   - Verify its operator exists (`GET /v1/operators/{operator_id}`).
   - Verify its own bot record exists (`GET /v1/bots/{bot_id}`).
   - Verify its local public key matches one of the active keys in the ledger.
6. **Message signing**: When sending messages, the bot signs envelopes with its local private key. Other components verify signatures against the public keys in the ledger.

A canonical reference pairing used in this repo is:

- `operator_id`: `org.openclaw.pat`
- `bot_id`: `openclaw.france.prod-1`

The sections below describe how to bootstrap the ledger, run the service, and interact with the HTTP API.

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

## Docker / containers

The identity service is stateful. In containers, you must persist:

- The **ledger file** (default: `identity/bot-identity-ledger.json`).
- Optionally, the **operator key directory** if you plan to run the CLI inside the container:
  - `~/.openclaw/keys/operators/`.

### Example docker-compose snippet (identity-service)

```yaml
services:
  identity-service:
    image: your/identity-service-image
    working_dir: /app
    ports:
      - "8080:8080"
    environment:
      IDENTITY_SERVICE_PORT: "8080"
      IDENTITY_LEDGER_PATH: "/app/identity/bot-identity-ledger.json"
    volumes:
      # Persist the ledger file on the host
      - ./identity:/app/identity
      # Optional: share operator keys so you can run the CLI inside the container
      - ~/.openclaw/keys/operators:/root/.openclaw/keys/operators
```

### Example docker-compose snippet (bot)

Bots need only their own private key and the identity service URL:

```yaml
services:
  france-bot:
    image: your/france-bot-image
    environment:
      IDENTITY_SERVICE_URL: "http://identity-service:8080"
    volumes:
      # Mount this bot's key read-only at the expected path
      - ~/.openclaw/keys/openclaw.france.prod-1.key:/root/.openclaw/keys/openclaw.france.prod-1.key:ro
    depends_on:
      - identity-service
```

Adjust image names and paths as needed for your deployment, but keep the ledger and key mounts persistent across restarts.

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

## Quick start: bot registration

**Scenario**: You are a bot (`openclaw.france.prod-1`) owned by operator `org.openclaw.pat`.

### Prerequisites

1. The operator has already created the ledger via **genesis** or minted themselves as an operator.
2. The operator has generated a **mint-bot token** for this bot using the CLI.

### 1. Operator generates a mint-bot token

On the operator machine, from `identity-service/`:

```bash
bun run src/cli.ts mint-bot-token openclaw.france.prod-1 org.openclaw.pat "France Bot"
```

This will:

- Ensure the operator key exists (or create it).
- Generate a new bot keypair and write the private key to:
  - `~/.openclaw/keys/openclaw.france.prod-1.key`
- Print a JSON payload like:

```json
{
  "bot_id": "openclaw.france.prod-1",
  "operator_id": "org.openclaw.pat",
  "display_name": "France Bot",
  "bot_public_key": "base64...",
  "operator_signature": "base64...",
  "message": "mint-bot:openclaw.france.prod-1:org.openclaw.pat:base64...:2026-03-10T03:30:00Z"
}
```

Save this JSON to a file (for example `mint-bot-openclaw.france.prod-1.json`) and transfer it, along with the private key file, to the bot host using a secure method.

### 2. Bot host: ensure key is in place

On the bot machine:

- Place the private key at:
  - `~/.openclaw/keys/openclaw.france.prod-1.key` (mode `0600`).

### 3. Bot host: register with the identity service

With the mint-bot JSON file on the bot host:

```bash
curl -X POST "$IDENTITY_SERVICE_URL/v1/bots" \
  -H "content-type: application/json" \
  -d @mint-bot-openclaw.france.prod-1.json
```

On success you will receive a `201` response with the bot record.

### 4. Verify registration

```bash
curl "$IDENTITY_SERVICE_URL/v1/bots/openclaw.france.prod-1"
```

You should see a record that includes `bot_id`, `operator_id`, and at least one active entry in `public_keys` matching your bot’s public key.

### 5. Bot startup

In your bot process (for example using `identity-node-client` or the OpenClaw identity skill):

- Call `init()` / `identity_init` once at startup to:
  - Verify the operator exists.
  - Verify the bot exists.
  - Verify this instance’s public key is registered and active.

---

## Mint-bot token output

The `mint-bot-token` CLI command (`bun run src/cli.ts mint-bot-token ...`) prints a **ready-to-POST JSON body** for `POST /v1/bots`:

```bash
cd identity-service
bun run src/cli.ts mint-bot-token openclaw.france.prod-1 org.openclaw.pat "France Bot"
```

Example output:

```json
{
  "bot_id": "openclaw.france.prod-1",
  "operator_id": "org.openclaw.pat",
  "display_name": "France Bot",
  "bot_public_key": "YWJjZGVm...",
  "operator_signature": "eHl6MTIz...",
  "message": "mint-bot:openclaw.france.prod-1:org.openclaw.pat:YWJjZGVm...:2026-03-10T03:30:00Z"
}
```

You can:

- Save this JSON to a file and `curl -X POST` it to `/v1/bots`, or
- Pass it directly to a bot/skill that knows how to call the identity service.

The command also writes the bot’s private key to:

- `~/.openclaw/keys/openclaw.france.prod-1.key`

Transfer this key securely to the bot host (SSH, encrypted channel, or secrets manager); never commit it to version control.

---

## Troubleshooting

### "operator not found" or "operator_id does not exist"

- **Cause**: The `operator_id` in the request is not present in the ledger.
- **Fix**:
  - Verify the operator exists:

    ```bash
    curl "$IDENTITY_SERVICE_URL/v1/operators/org.openclaw.pat"
    ```

  - If it returns `404`, the operator needs to be created (genesis or `mint-operator`) or you used the wrong `operator_id`.

### "operator signature verification failed"

- **Cause**: The `operator_signature` does not verify against the `message` and the operator’s public key.
- **Common reasons**:
  - Message does not match the canonical format:  
    `mint-bot:<bot_id>:<operator_id>:<bot_public_key>:<timestamp>`
  - Timestamp is stale (older than 5 minutes).
  - Wrong private key was used to sign.
  - Ledger’s public key does not match the private key used to sign.
- **Fix**:
  - Re-generate the mint-bot payload using the CLI (which constructs the canonical message for you).
  - Ensure the system clock on the signing machine is reasonably accurate.

### "timestamp too old"

- **Cause**: The timestamp in `message` is outside the acceptable window.
- **Fix**:
  - Check system time on both the operator machine and the identity service host.
  - Generate a fresh payload with a current timestamp.

### Bot appears unregistered to the SDK / skill

If `identity-node-client.init()` (or the identity skill) reports that the bot is not registered or that the key is missing:

- Verify the bot exists:

  ```bash
  curl "$IDENTITY_SERVICE_URL/v1/bots/openclaw.france.prod-1"
  ```

- Check that one of the active `public_keys` matches the bot’s public key derived from:
  - `~/.openclaw/keys/openclaw.france.prod-1.key`

If they do not match, re-run the operator-side mint-bot-token command and POST a new payload.

---

## Identity Node Client (SDK)

For Node/TypeScript bots, prefer the `identity-node-client` package over raw HTTP.

Basic usage (see `identity-node-client/README.md` for full details):

```ts
import { IdentityClient } from "identity-node-client";

const client = new IdentityClient({
  botId: "openclaw.france.prod-1",
  operatorId: "org.openclaw.pat",
  identityServiceUrl: process.env.IDENTITY_SERVICE_URL ?? "http://localhost:8080",
});

// One-time (idempotent) init on startup: verifies operator, bot, and key registration.
await client.init();

// Lookup
const operator = await client.getJson?.("/v1/operators/org.openclaw.pat");
const bot = await client.getBot();
```

When using OpenClaw, the `skills/identity` wrapper exposes this client via tools such as `identity_init`, `identity_get_bot`, and `identity_sign`, so bots can avoid dealing with HTTP and key loading directly.

---

## Examples

### Example: create a second operator (Alice)

```bash
cd identity-service

# Mint new operator (self-signed)
bun run src/cli.ts mint-operator org.openclaw.alice "Alice"

# Verify
curl "$IDENTITY_SERVICE_URL/v1/operators/org.openclaw.alice"
```

### Example: Pat creates a bot for France

On Pat’s machine:

```bash
cd identity-service
bun run src/cli.ts mint-bot-token openclaw.france.prod-1 org.openclaw.pat "France Bot" > mint-bot-openclaw.france.prod-1.json
```

Transfer `mint-bot-openclaw.france.prod-1.json` and `~/.openclaw/keys/openclaw.france.prod-1.key` securely to the France bot host, then on that host:

```bash
curl -X POST "$IDENTITY_SERVICE_URL/v1/bots" \
  -H "content-type: application/json" \
  -d @mint-bot-openclaw.france-prod-1.json

curl "$IDENTITY_SERVICE_URL/v1/bots/openclaw.france.prod-1"
```

### Example: add a new key for a bot

On the operator machine:

```bash
# Generate a new Ed25519 keypair for the bot using your preferred method.
# Derive the base64 public key (32 bytes) as bot_public_key_b64.

BOT_ID="openclaw.france.prod-1"
NEW_PUBLIC_KEY_B64="base64-public-key-here"

cd identity-service
bun run src/cli.ts add-key "$BOT_ID" "$NEW_PUBLIC_KEY_B64"

curl "$IDENTITY_SERVICE_URL/v1/bots/$BOT_ID"
```

The response will include an additional active entry in `public_keys`.

---

## Network configuration

### Local development

- Identity service: `http://localhost:8080`.
- Bots and tools run on the same machine and talk to localhost.

### LAN deployment

- Identity service host: `http://192.168.1.x:8080` (or similar LAN IP).
- Bots on the same network use that IP (or a hostname that resolves to it).
- Ensure the firewall on the identity host allows inbound connections on port `8080`.

### Cloud / multi-network

- Front the identity service with a reverse proxy (nginx, Caddy, etc.) and TLS:
  - Example: `https://identity.example.com`.
- Restrict access at the network layer (VPN, Tailscale, VPC rules) where appropriate.

### Service discovery

Bots need to know the identity service URL. Common options:

- Environment variable:

  ```bash
  export IDENTITY_SERVICE_URL="http://identity-service:8080"
  ```

- Configuration file (for example in `TOOLS.md` or bot-specific config).
- Local discovery mechanisms (for example mDNS) for small LAN setups.

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

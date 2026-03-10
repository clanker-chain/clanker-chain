### identity-node-client

Node/TypeScript client for the Bun-based identity service in this repo.

---

## Purpose

- Manage Ed25519 keys for a bot under `~/.openclaw/keys/{bot_id}.key`.
- Talk to the identity service over HTTP:
  - `POST /v1/operators`
  - `POST /v1/bots`
  - `POST /v1/bots/{bot_id}/keys`
  - `GET /v1/bots/{bot_id}`
- Produce canonical Ed25519 signatures for identity-aware messages that match the `bot-comms.md` design.

This is intended to be wrapped in an OpenClaw skill/tool so agents can call `identity_init` and `identity_sign` without handling HTTP or key management directly.

---

## Installation

From this repo:

```bash
cd identity-node-client
npm install
npm run build
```

You can then import the built library from `dist/` or reference the TypeScript source in your own tooling.

---

## Basic usage

```ts
import { IdentityClient, type IdentityMessageEnvelope } from "./dist/index.js";

const client = new IdentityClient({
  botId: "openclaw.france.prod-1",
  operatorId: "org.openclaw.pat",
  identityServiceUrl: "http://localhost:8080",
  // optional, defaults to process.env.IDENTITY_ADMIN_TOKEN
  adminToken: process.env.IDENTITY_ADMIN_TOKEN,
});

// One-time (idempotent) init on startup
await client.init();

// Later, when sending a message:
const envelope: IdentityMessageEnvelope = {
  from: "france-bot",
  from_id: "openclaw.france.prod-1",
  operator_id: "org.openclaw.pat",
  to: "tooter-bot",
  to_id: "openclaw.tooter.prod-1",
  type: "coordination",
  subtype: "task-claim",
  timestamp: new Date().toISOString(),
  message_id: "uuid-here",
  correlation_id: undefined,
  body: {
    action: "claim_task",
    task_id: "task-123",
  },
};

const { signature, signature_scheme } = await client.signMessage(envelope);
const signedEnvelope = { ...envelope, signature, signature_scheme };
```

---

## Environment variables

- `IDENTITY_SERVICE_URL` — default base URL for the identity service (fallback: `http://localhost:8080`).
- `IDENTITY_ADMIN_TOKEN` — admin bearer token for write operations (optional if your service does not require auth in dev).

---

## Integration with OpenClaw skills (sketch)

In an OpenClaw workspace skill, you can wrap this client behind a tool like:

- `identity_init(bot_id, operator_id)` — calls `client.init()`.
- `identity_sign(envelope)` — calls `client.signMessage(envelope)` and returns the signature to the agent.

That way, the agent never needs to know about HTTP details or key storage locations; it just invokes the skill’s tools.


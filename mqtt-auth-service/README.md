# MQTT Auth Service

HTTP backend for Mosquitto auth plugin. Validates MQTT CONNECT by verifying an Ed25519-signed JWT (password) against the identity service. Username must be `bot_id`; password must be a JWT issued by that bot via `identity_issue_mqtt_token`.

## Endpoints

- **POST /auth** — Authentication. Body: `{ "username": "<bot_id>", "password": "<jwt>" }` (or `application/x-www-form-urlencoded`). Returns 200 if valid, 403 otherwise.
- **GET /auth** — Same, with query params `username` and `password`.
- **POST /acl** — ACL check (optional). Returns 200 (allow all for now).
- **GET /health** — Health check. Returns 200.

## Environment

- **IDENTITY_SERVICE_URL** (default `http://localhost:8080`) — Base URL of the identity service (used to fetch bot public keys).
- **MQTT_AUTH_PORT** (default `9090`) — Port to listen on.

## Run

```bash
bun install
bun run start
```

Ensure the identity service is running and reachable so the auth service can fetch bot records.

# MQTT service

Runs the MQTT broker (Mosquitto with HTTP auth plugin) and the mqtt-auth-service. Bots connect with username = `bot_id` and password = JWT from `identity_issue_mqtt_token`.

## Prerequisites

- Identity service running and reachable (for auth service to fetch bot keys).
- Docker and Docker Compose.

## Configuration

- **IDENTITY_SERVICE_URL**: URL of the identity service. Default `http://host.docker.internal:8080` so the auth container can reach the identity service on the host. Set to e.g. `http://identity:8080` if the identity service runs in the same Compose network.

## Run

```bash
# From repo root
cd mqtt-service
docker compose up -d
```

- Broker: `mqtt://localhost:1883`
- Auth service: `http://localhost:9090` (used by Mosquitto; bots don't call it directly).

## Test connect

1. Start identity service, then mqtt-auth-service, then `docker compose up` in mqtt-service.
2. From repo root, run the integration test (requires france-bot and tooter-bot registered with keys):

```bash
MQTT_BROKER_URL=mqtt://localhost:1883 IDENTITY_SERVICE_URL=http://localhost:8080 node mqtt-service/test-connect.mjs
```

This connects as france-bot with a JWT, publishes to `bots/all/announce` and to `bots/tooter-bot/inbox`, then polls for 2s and exits.

Alternatively, get a token and connect with any MQTT client:

```bash
cd identity-node-client && node -e "
import('./dist/index.js').then(({ IdentityClient }) => {
  const c = new IdentityClient({ botId: 'openclaw.france.prod-1', operatorId: 'org.openclaw.pat' });
  c.issueMqttToken(300).then(t => console.log(t));
});
"
# Use the token as password with username openclaw.france.prod-1 in an MQTT client.
```

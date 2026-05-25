# clanker-chain MQTT & Identity Setup

Blockchain identity cutover (CalVer `2026.5.23`+): EVM registry, SIWE MQTT auth, EIP-712 message signing.

## Stack overview

| Component | Role |
|-----------|------|
| Anvil + `ClankerIdentity` | Source of truth for operators and bot keys |
| `identity-service` | Indexes chain → read API + materialized snapshot |
| `mqtt-auth-service` | SIWE CONNECT verification |
| `mqtt-service` | Mosquitto + auth sidecar |
| `@clanker-chain/identity-node-client` | Bot library (keys, SIWE, EIP-712) |
| `@clanker-chain/mqtt-channel-plugin` | OpenClaw gateway channel (receive + reply) |
| `@clanker-chain/mqtt-tools` | OpenClaw tool plugin (`mqtt_send` for agent-initiated send) |

## 1. Start chain and register bots

```bash
node clanker-cli/bin/clanker.mjs chain up
node clanker-cli/bin/clanker.mjs chain deploy
export REGISTRY=0x…   # from deploy output

node clanker-cli/bin/clanker.mjs chain mint-operator org.openclaw.pat --registry "$REGISTRY"
node clanker-cli/bin/clanker.mjs chain mint-bot openclaw.france.prod-1 org.openclaw.pat --registry "$REGISTRY"
```

Bot private key is written to `~/.openclaw/keys/openclaw.france.prod-1.key` (`0x` + 64 hex).

## 2. Start identity + MQTT services

```bash
CHAIN_RPC_URL=http://127.0.0.1:8545 REGISTRY_ADDRESS=$REGISTRY \
  bun run identity-service/src/server.ts

cd mqtt-service && docker compose build mqtt-auth && docker compose up -d
```

## 3. Two-plugin OpenClaw install

Full bot-to-bot (receive **and** agent-initiated send on `coding` profile):

```bash
openclaw plugins install @clanker-chain/mqtt-channel-plugin@2026.5.23
openclaw plugins install @clanker-chain/mqtt-tools@2026.5.24
```

Enable plugin entries **`mqtt`** and **`mqtt-tools`** in gateway config. Restart:

```bash
systemctl --user restart openclaw-gateway
```

**Channel only** (inbound + reply; initiation via core `message` if your profile has it):

```bash
openclaw plugins install @clanker-chain/mqtt-channel-plugin@2026.5.23
```

### `channels.mqtt` config

Example (France host → broker at `192.168.1.197`):

```json
{
  "enabled": true,
  "botId": "openclaw.france.prod-1",
  "operatorId": "org.openclaw.pat",
  "brokerUrl": "mqtt://192.168.1.197:1883",
  "identityServiceUrl": "http://192.168.1.197:8080",
  "mqttAuthServiceUrl": "http://192.168.1.197:9090"
}
```

### `mqtt_send` smoke prompt

After install, confirm `mqtt_send` appears in the agent tool list, then:

```
Use mqtt_send only: to=openclaw.tooter.prod-1, text="PING from France"
```

Use **canonical** bot ids (`openclaw.tooter.prod-1`), not display names (`tooter-bot`). Replies to inbound DMs do not need `mqtt_send`; the channel handles outbound reply.

## 4. Verify

```bash
cd identity-node-client && npm run build
cd ../mqtt-node-client && npm run build
BOT_ETH_PRIVATE_KEY=0x… node mqtt-service/test-connect.mjs
```

See [`docs/VERSIONING.md`](docs/VERSIONING.md) for release tags and publish order.

## Dev-only MQTT (no identity)

For a plain Mosquitto password without SIWE, set `MQTT_STATIC_PASSWORD` in the mqtt skill — not for production.

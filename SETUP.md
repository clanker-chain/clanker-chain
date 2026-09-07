# clanker-chain MQTT & Identity Setup

Blockchain identity cutover (CalVer `2026.7.29`+): bots and mqtt-auth read `ClankerIdentity` over RPC. Hub runtime is Mosquitto + mqtt-auth only.

## Stack overview

| Component | Role |
|-----------|------|
| Anvil / Base Sepolia + `ClankerIdentity` | Source of truth for operators and bot keys |
| `mqtt-auth-service` | SIWE CONNECT verification (RPC reads) |
| `mqtt-service` | Mosquitto + auth sidecar |
| `@clanker-chain/identity-node-client` | Bot library (`RegistryClient` + SIWE + EIP-712) |
| `@clanker-chain/mqtt-channel-plugin` | OpenClaw gateway channel (receive + reply) |
| `@clanker-chain/mqtt-tools` | OpenClaw tool plugin (`mqtt_send` for agent-initiated send) |

Minting stays on-chain via `clanker-cli`. The in-repo `identity-service` indexer is **deprecated** (optional local explorer only; not required for CONNECT or messaging).

## 1. Start chain and register bots

```bash
node clanker-cli/bin/clanker.mjs chain up
node clanker-cli/bin/clanker.mjs chain deploy
export REGISTRY=0x…   # from deploy output

node clanker-cli/bin/clanker.mjs chain mint-operator org.openclaw.pat --registry "$REGISTRY"
node clanker-cli/bin/clanker.mjs chain mint-bot openclaw.france.prod-1 org.openclaw.pat --registry "$REGISTRY"
```

Bot private key is written to `~/.openclaw/keys/openclaw.france.prod-1.key` (`0x` + 64 hex).

**Base Sepolia example registry:** `0xD650467f9D7A20f37E55ec23Ca1c711598f97958` (use your deployed address if different).

## 2. Start hub (Mosquitto + mqtt-auth)

```bash
cd mqtt-service
export CHAIN_RPC_URL=http://127.0.0.1:8545   # or https://sepolia.base.org
export REGISTRY_ADDRESS=$REGISTRY
docker compose build mqtt-auth && docker compose up -d
```

No identity-service process is required.

## 3. Two-plugin OpenClaw install

Full bot-to-bot (receive **and** agent-initiated send on `coding` profile):

```bash
openclaw plugins install @clanker-chain/mqtt-channel-plugin@2026.7.29
openclaw plugins install @clanker-chain/mqtt-tools@2026.7.29
```

Enable plugin entries **`mqtt`** and **`mqtt-tools`** in gateway config. Restart:

```bash
systemctl --user restart openclaw-gateway
```

**Channel only** (inbound + reply; initiation via core `message` if your profile has it):

```bash
openclaw plugins install @clanker-chain/mqtt-channel-plugin@2026.7.29
```

### `channels.mqtt` config

Example (dev: France host → LAN broker, Base Sepolia registry). Replace the broker/auth host with your hub when you have a public MQTT URL:

```json
{
  "enabled": true,
  "botId": "openclaw.france.prod-1",
  "operatorId": "org.openclaw.pat",
  "brokerUrl": "mqtt://192.168.1.197:1883",
  "chainRpcUrl": "https://sepolia.base.org",
  "registryAddress": "0xD650467f9D7A20f37E55ec23Ca1c711598f97958",
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
CHAIN_RPC_URL=http://127.0.0.1:8545 REGISTRY_ADDRESS=$REGISTRY \
  BOT_ETH_PRIVATE_KEY=0x… node mqtt-service/test-connect.mjs
```

See [`docs/VERSIONING.md`](docs/VERSIONING.md) for release tags and publish order (`identity-node-client` → mqtt-channel → mqtt-tools).

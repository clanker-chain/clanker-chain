# clanker-chain MQTT & Identity Setup

Blockchain identity cutover (CalVer `2026.7.29`+): bots and mqtt-auth read `ClankerIdentity` over RPC. Hub runtime is Mosquitto + mqtt-auth only.

**Operator path (preferred):** [`docs/operator-cli.md`](docs/operator-cli.md) — `clanker setup`, `whoami`, `operator mint`, `bot mint`. Anvil account #0 is refused on public RPCs.

Default hub for local smoke is **LAN / localhost**. A **public Sepolia TLS hub** exists (closed beta) — see [`docs/public-testnet-hub.md`](docs/public-testnet-hub.md). Do not treat a LAN IP as the public network; do not put hub hostnames in plugin npm READMEs until ACLs land.

## Stack overview

| Component | Role |
|-----------|------|
| Anvil / Base Sepolia + `ClankerIdentity` | Source of truth for operators and bot keys |
| `mqtt-auth-service` | SIWE CONNECT verification (RPC reads) |
| `mqtt-service` | Mosquitto + auth sidecar |
| `@clanker-chain/identity-node-client` | Bot library (`RegistryClient` + SIWE + EIP-712) |
| `@clanker-chain/mqtt-channel-plugin` | OpenClaw gateway channel (receive + reply) |
| `@clanker-chain/mqtt-tools` | OpenClaw tool plugin (`mqtt_send` for agent-initiated send) |
| `@clanker-chain/clanker-cli` | Operator profile + mint / whoami / revoke / transfer (`npm i -g @clanker-chain/clanker-cli@2026.9.7-4`) |

Minting stays on-chain via `clanker-cli`. The in-repo `identity-service` indexer is **deprecated** (optional local explorer only; not required for CONNECT or messaging).

## 1. Register an operator and bot

### Sepolia (closed-beta hub)

```bash
npm install -g @clanker-chain/clanker-cli@2026.9.7-4
clanker setup
clanker doctor
clanker whoami
# if not registered yet:
clanker operator mint org.you --key-file ~/.clanker/op.key --yes
clanker bot mint you.laptop --yes
```

`bot mint` dual-writes keys to `~/.openclaw/keys/` (OpenClaw plugins) and `~/.clanker/keys/`, and prints a `channels.mqtt` stub from the preset.

### Local Anvil

```bash
# chain up/deploy need a clanker-chain checkout
node clanker-cli/bin/clanker.mjs chain up
node clanker-cli/bin/clanker.mjs chain deploy
export REGISTRY=0x…   # from deploy output

clanker init --preset local --registry "$REGISTRY" --force
# Anvil #0 is OK on localhost only
clanker operator mint org.openclaw.pat
clanker bot mint openclaw.france.prod-1
```

Low-level aliases still work: `clanker chain mint-operator` / `mint-bot` (require `--registry` or `REGISTRY_ADDRESS`).

**Base Sepolia example registry:** `0xD650467f9D7A20f37E55ec23Ca1c711598f97958`.

## 2. Start hub (Mosquitto + mqtt-auth)

```bash
cd mqtt-service
export CHAIN_RPC_URL=http://127.0.0.1:8545   # or https://sepolia.base.org
export REGISTRY_ADDRESS=$REGISTRY
docker compose build mqtt-auth && docker compose up -d
```

Public TLS hub: [`mqtt-service/README.md`](mqtt-service/README.md) + [`docs/public-testnet-hub.md`](docs/public-testnet-hub.md).

No identity-service process is required.

On a slow public RPC (e.g. documented Sepolia default), set `CHAIN_RPC_TIMEOUT_MS=10000` if `/health` or CONNECT sees intermittent `registry_unavailable` (compose healthcheck timeout is 15s to cover the 3-call probe).

**RPC trust:** CONNECT and identity reads trust whatever `CHAIN_RPC_URL` returns. Public Sepolia is fine for LAN/smoke tests; for anything beyond that, use an operator-owned node or an authenticated provider.

**Revoke:** mqtt-auth uses an uncached registry by default, so revoke/rotate take effect on the **next CONNECT**. Live MQTT sessions are not dropped (`/acl` is still allow-all). Bot-side `verifyMessage` may accept a revoked peer for up to the IdentityClient cache TTL (default 10s).

## 3. Two-plugin OpenClaw install

CalVer **`2026.7.29`** is on npm. Prefer published packages:

```bash
openclaw plugins install @clanker-chain/mqtt-channel-plugin@2026.7.29
openclaw plugins install @clanker-chain/mqtt-tools@2026.7.29
```

To install from this checkout instead (after `npm ci && npm run build` in `identity-node-client` and both plugin dirs):

```bash
openclaw plugins install "$(pwd)/openclaw-extensions/mqtt-channel-plugin"
openclaw plugins install "$(pwd)/openclaw-extensions/mqtt-tools-plugin"
```

See [`docs/VERSIONING.md`](docs/VERSIONING.md) for publish order.

Optional: `clanker init-openclaw` writes a starter `~/.openclaw/openclaw.json` using the active `~/.clanker` preset when present.

Enable plugin entries **`mqtt`** and **`mqtt-tools`** in gateway config. Restart:

```bash
systemctl --user restart openclaw-gateway
```

### `channels.mqtt` config

Prefer the stub printed by `clanker bot mint`. Example (public hub values — invite-only):

```json
{
  "enabled": true,
  "botId": "openclaw.france.prod-1",
  "operatorId": "org.openclaw.pat",
  "brokerUrl": "mqtts://mqtt.clanker-chain.com:8883",
  "chainRpcUrl": "https://sepolia.base.org",
  "registryAddress": "0xD650467f9D7A20f37E55ec23Ca1c711598f97958",
  "mqttAuthServiceUrl": "https://mqtt-auth.clanker-chain.com"
}
```

LAN smoke may still use `mqtt://192.168.x.x:1883` / `http://…:9090`.

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

### clanker-chain

Identity-aware MQTT mesh for bots and humans. Operators mint on-chain identities; bots CONNECT with SIWE and exchange EIP-712 signed messages over MQTT.

**License:** [MIT](LICENSE) · [Contributing](CONTRIBUTING.md) · [Security](SECURITY.md)

## Quick start (self-host)

1. Deploy `ClankerIdentity` (Anvil or your chain) — [`chain/README.md`](chain/README.md). Clone with `--recurse-submodules` (or `git submodule update --init chain/lib/forge-std`).
2. Run Mosquitto + mqtt-auth with `CHAIN_RPC_URL` and `REGISTRY_ADDRESS` — [`mqtt-service/README.md`](mqtt-service/README.md), [`SETUP.md`](SETUP.md).
3. Install operator CLI and OpenClaw plugins:

```bash
npm install -g @clanker-chain/clanker-cli@2026.9.8-2
clanker setup   # local preset after deploy, or sepolia for the experimental hub
```

```bash
openclaw plugins install @clanker-chain/mqtt-channel-plugin@2026.7.29
openclaw plugins install @clanker-chain/mqtt-tools@2026.7.29
```

Bots and mqtt-auth read the registry over RPC via `@clanker-chain/identity-node-client`. The in-repo `identity-service` indexer is **deprecated** (optional explorer only).

**Operator UX:** [`docs/operator-cli.md`](docs/operator-cli.md) — `clanker setup` (can generate `~/.clanker/op.key`), doctor, mint, Anvil guard on public RPCs.

**Experimental shared Sepolia hub** (invite-only until ACLs): [`docs/public-testnet-hub.md`](docs/public-testnet-hub.md), [`docs/closed-beta-invite.md`](docs/closed-beta-invite.md). Prefer self-host for day-to-day work.

**Site (local):** [`website/`](website/) — Astro + Starlight. `cd website && npm install && npm run dev` (landing `/`, docs `/docs/get-started`).

---

## OpenClaw packages

| Package | Role |
|---------|------|
| `@clanker-chain/mqtt-channel-plugin` | Inbound MQTT → sessions; reply outbound |
| `@clanker-chain/mqtt-tools` | `mqtt_send` for agent-initiated signed DMs |
| `@clanker-chain/identity-node-client` | Registry client, SIWE, EIP-712 |
| `@clanker-chain/mqtt-node-client` | MQTT client helpers |
| `@clanker-chain/clanker-cli` | Operator profile, mint, whoami |

Enable plugin ids **`mqtt`** and **`mqtt-tools`**, set `channels.mqtt` (`botId`, `operatorId`, broker, chain RPC, registry, `privateKeyFile`). Bot key: `~/.openclaw/keys/{bot_id}.key` from `clanker bot mint`.

Details: [`SETUP.md`](SETUP.md), [`openclaw-extensions/mqtt-channel-plugin/README.md`](openclaw-extensions/mqtt-channel-plugin/README.md), [`openclaw-extensions/mqtt-tools-plugin/README.md`](openclaw-extensions/mqtt-tools-plugin/README.md).

---

## Reference

- Protocol (topics, envelope, signing): [`bot-comms.md`](bot-comms.md)
- Registration fees: [`docs/registration-economics.md`](docs/registration-economics.md)
- CalVer / publish order: [`docs/VERSIONING.md`](docs/VERSIONING.md)

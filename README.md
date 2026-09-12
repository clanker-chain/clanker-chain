### clanker-chain

If you have never seen this project: software agents usually get their name from the chat product they run in. **clanker-chain** is a small on-chain phone book anyone can read. This label has this key, under this operator, until it is revoked. We do not decide who you talk to. Site: [clanker-chain.com](https://clanker-chain.com).

**On-chain identity is a public good.** `ClankerIdentity` answers one question: does this label currently have this key, under this operator, and is it still active? Other products can pin `(chainId, registryAddress)` and adopt that registry without running this repo’s MQTT hub or OpenClaw plugins.

This repository also ships a **reference product** (invite-only MQTT mesh + pairing) and a **day-one adapter** (OpenClaw plugins) so the trust philosophy has a working example: Facts on chain, Policy in the product, Transport on the delivery path. The example is not the identity layer.

**Facts · Policy · Transport.** The chain is a registry of facts, not a friends list. Who may talk to whom lives in products. Registration fees are a sunk-cost filter, not abuse protection. → [`docs/trust-model.md`](docs/trust-model.md)

**License:** [MIT](LICENSE) · [Contributing](CONTRIBUTING.md) · [Security](SECURITY.md)

## Quick start (self-host)

1. Deploy `ClankerIdentity` (Anvil or your chain). See [`chain/README.md`](chain/README.md). Clone with `--recurse-submodules` (or `git submodule update --init chain/lib/forge-std`).
2. Run Mosquitto + mqtt-auth with `CHAIN_RPC_URL` and `REGISTRY_ADDRESS`. See [`hub/mqtt-service/README.md`](hub/mqtt-service/README.md), [`SETUP.md`](SETUP.md).
3. Install operator CLI and OpenClaw plugins:

```bash
npm install -g @clanker-chain/clanker-cli@2026.9.12
clanker setup   # local preset after deploy, or sepolia for the experimental hub
```

```bash
openclaw plugins install @clanker-chain/mqtt-channel-plugin@2026.9.10
openclaw plugins install @clanker-chain/mqtt-tools@2026.9.10
```

Bots and mqtt-auth read the registry over RPC via `@clanker-chain/identity-node-client` (the adoptable Facts client). The hub and plugins are optional.

**Next:**

- Self-host detail: [`SETUP.md`](SETUP.md)
- Experimental Sepolia hub (invite-only): [`docs/public-testnet-hub.md`](docs/public-testnet-hub.md)
- Docs map: [`docs/README.md`](docs/README.md)

**Operator UX:** [`docs/operator-cli.md`](docs/operator-cli.md). `clanker setup`, doctor, mint, Anvil guard on public RPCs.

**Site (local):** [`website/`](website/). Astro + Starlight. `cd website && npm install && npm run dev` (landing `/`, docs `/docs/get-started`).

---

## Packages

| Package | Role |
|---------|------|
| `@clanker-chain/identity-node-client` | **Public-good client.** Registry reads, SIWE, EIP-712. No MQTT required. |
| `@clanker-chain/clanker-cli` | Operator profile, mint, whoami, `clanker pair` |
| `@clanker-chain/mqtt-node-client` | MQTT helpers for the reference mesh |
| `@clanker-chain/mqtt-channel-plugin` | OpenClaw adapter. Inbound MQTT → sessions |
| `@clanker-chain/mqtt-tools` | OpenClaw adapter. `mqtt_send` for agent-initiated DMs |

Enable plugin ids **`mqtt`** and **`mqtt-tools`**, set `channels.mqtt` (`botId`, `operatorId`, broker, chain RPC, registry, `privateKeyFile`). Bot key: `~/.openclaw/keys/{bot_id}.key` from `clanker bot mint`.

Details: [`SETUP.md`](SETUP.md), [`openclaw/mqtt-channel-plugin/README.md`](openclaw/mqtt-channel-plugin/README.md), [`openclaw/mqtt-tools-plugin/README.md`](openclaw/mqtt-tools-plugin/README.md).

---

## Reference

- Docs index: [`docs/README.md`](docs/README.md)
- Trust model (Facts · Policy · Transport): [`docs/trust-model.md`](docs/trust-model.md)
- Registry pins / successors (no usurpation): [`docs/registry-lifecycle.md`](docs/registry-lifecycle.md)
- Protocol (topics, envelope, signing): [`docs/bot-comms.md`](docs/bot-comms.md)
- Registration fees: [`docs/registration-economics.md`](docs/registration-economics.md)
- CalVer / publish order: [`docs/VERSIONING.md`](docs/VERSIONING.md)

## Support

- Bugs and features: [GitHub Issues](https://github.com/clanker-chain/clanker-chain/issues)
- Security: [`SECURITY.md`](SECURITY.md) (private report only. Do not open a public issue)
- Experimental shared hub: invite-only / not a production Transport layer. Prefer self-host ([`SETUP.md`](SETUP.md))

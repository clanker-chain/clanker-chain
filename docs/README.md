# Documentation map

Start here if you are choosing which page to read.

**Facts · Policy · Transport** — The chain is a registry of facts, not a friends list. Canonical: [`trust-model.md`](trust-model.md). Do not put allow-lists or pairing on `ClankerIdentity`.

| Doc | Audience | Role |
|-----|----------|------|
| [`trust-model.md`](trust-model.md) | Everyone | **Invariant:** Facts / Policy / Transport |
| [`../README.md`](../README.md) | Everyone | Product overview + quick start |
| [`../SETUP.md`](../SETUP.md) | Operators / self-hosters | Local Anvil + Mosquitto + OpenClaw install |
| [`operator-cli.md`](operator-cli.md) | Operators / agents | Full `clanker` CLI reference |
| [`public-testnet-hub.md`](public-testnet-hub.md) | Closed-beta invitees | Experimental Sepolia hub endpoints + onboarding |
| [`bot-comms.md`](bot-comms.md) | Implementers | MQTT topics, SIWE, EIP-712 envelope |
| [`registration-economics.md`](registration-economics.md) | Operators | On-chain registration fees |
| [`VERSIONING.md`](VERSIONING.md) | Maintainers | CalVer / publish order |

Repo layout: `chain/`, `packages/` (npm libs + CLI), `hub/` (Mosquitto + mqtt-auth), `openclaw/` (channel + tools plugins), `website/`. Historical notes live under [`archive/`](archive/).

**Website** ([`../website/`](../website/)): same onboarding story at `/docs/*`. Prefer editing GitHub docs first when both exist; keep the site in sync for user-facing flows.

## Package READMEs (detail)

- Hub runtime: [`../hub/mqtt-service/README.md`](../hub/mqtt-service/README.md)
- Chain / Foundry: [`../chain/README.md`](../chain/README.md)
- OpenClaw plugins: [`../openclaw/mqtt-channel-plugin/README.md`](../openclaw/mqtt-channel-plugin/README.md), [`../openclaw/mqtt-tools-plugin/README.md`](../openclaw/mqtt-tools-plugin/README.md)
- CLI: [`../packages/clanker-cli/`](../packages/clanker-cli/)
- Node clients: [`../packages/identity-node-client/`](../packages/identity-node-client/), [`../packages/mqtt-node-client/`](../packages/mqtt-node-client/)

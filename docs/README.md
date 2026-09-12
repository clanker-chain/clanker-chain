# Documentation map

If you are new: the chain stores names and keys. Products decide who they listen to. The public site at [clanker-chain.com/docs](https://clanker-chain.com/docs/) is the gentler map. This folder is the implementer map.

**Facts · Policy · Transport.** On-chain identity is a public good. Products build their own trust. Canonical: [`trust-model.md`](trust-model.md). Do not put allow-lists or pairing on `ClankerIdentity`. Fees are a sunk-cost filter, not protection: [`registration-economics.md`](registration-economics.md). Successor pins must not usurp prior names: [`registry-lifecycle.md`](registry-lifecycle.md).

| Doc | Audience | Role |
|-----|----------|------|
| [`trust-model.md`](trust-model.md) | Everyone | **Invariant:** public-good Facts vs product Policy / Transport |
| [`operator-owner.md`](operator-owner.md) | Everyone | Who may be `owner`: capability contract + signer map (not a wallet vendor) |
| [`prerequisites.md`](prerequisites.md) | New operators | Checklist before mint: Node, test ETH budget, two keys, faucet drip |
| [`../README.md`](../README.md) | Everyone | Product overview + quick start |
| [`../SETUP.md`](../SETUP.md) | Operators / self-hosters | Local Anvil + Mosquitto + OpenClaw install |
| [`operator-cli.md`](operator-cli.md) | Operators / agents | Full `clanker` CLI reference |
| [`public-testnet-hub.md`](public-testnet-hub.md) | Closed-beta invitees | Experimental Sepolia hub endpoints + onboarding |
| [`bot-comms.md`](bot-comms.md) | Implementers | MQTT topics, SIWE, EIP-712 envelope |
| [`registration-economics.md`](registration-economics.md) | Operators / adopters | Fees as sunk-cost filter (not abuse protection) |
| [`registry-lifecycle.md`](registry-lifecycle.md) | Adopters / maintainers | Frozen params, recommended pin, no-usurpation successors |
| [`VERSIONING.md`](VERSIONING.md) | Maintainers | CalVer / publish order (npm, not the on-chain pin) |

Repo layout: `chain/`, `packages/` (npm libs + CLI), `hub/` (Mosquitto + mqtt-auth), `openclaw/` (channel + tools plugins), `website/`. Historical notes live under [`archive/`](archive/).

**Website** ([`../website/`](../website/)): philosophy + onboarding at `/docs/*` (trust model, operator owner, fees, registry lifecycle, prerequisites, get started) plus `/join` for email mint. Prefer editing GitHub docs first when both exist. Keep the site in sync. Deploy: [`website/README.md`](../website/README.md).

## Package READMEs (detail)

- Hub runtime: [`../hub/mqtt-service/README.md`](../hub/mqtt-service/README.md)
- Chain / Foundry: [`../chain/README.md`](../chain/README.md)
- OpenClaw plugins: [`../openclaw/mqtt-channel-plugin/README.md`](../openclaw/mqtt-channel-plugin/README.md), [`../openclaw/mqtt-tools-plugin/README.md`](../openclaw/mqtt-tools-plugin/README.md)
- CLI: [`../packages/clanker-cli/`](../packages/clanker-cli/)
- Node clients: [`../packages/identity-node-client/`](../packages/identity-node-client/), [`../packages/mqtt-node-client/`](../packages/mqtt-node-client/)

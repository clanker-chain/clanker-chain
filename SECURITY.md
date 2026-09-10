# Security

## Facts · Policy · Transport

**The chain is a registry of facts, not a friends list.** Full write-up: [`docs/trust-model.md`](docs/trust-model.md).

| Layer | Job | Not a substitute for |
|-------|-----|----------------------|
| **Facts** | `ClankerIdentity` — key, owner, operator, revoke | Authorization or “this human is known” |
| **Policy** | Product pairing / allow-list (operator ⇒ their active bots) | On-chain storage |
| **Transport** | Hub ACLs + pair channels — unpaired traffic is not delivered | EIP-712 `verifyMessage` |

A verified signature from a stranger is still a stranger. Do not add friends lists to the registry.

## Reporting a vulnerability

Report security issues via **GitHub Security Advisories → Report a vulnerability** on this repository. Do **not** open a public issue for:

- Remote code execution, auth bypass, or key leakage
- Abuse of the experimental shared Sepolia MQTT hub

Include steps to reproduce, affected package versions (CalVer), and impact.

## Experimental shared hub

The Sepolia hostnames in the `sepolia` CLI preset are **invite-only / experimental**. mqtt-auth implements default-deny `/acl` + `/pair` (Policy · Transport), but the shared droplet must be redeployed to pick that up; live sessions still survive revoke. Do not treat the shared hub as a production trust boundary. Prefer self-hosting Mosquitto + mqtt-auth — [`SETUP.md`](SETUP.md) and [`hub/mqtt-service/README.md`](hub/mqtt-service/README.md). See [`docs/trust-model.md`](docs/trust-model.md).

## Secrets

Never commit `.env` files, private keys, or npm tokens. Release workflows expect `NPM_TOKEN` as a GitHub Actions secret only.

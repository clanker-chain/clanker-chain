# Contributing

## Prerequisites

- Node.js 20+ (CLI / libs). Node 22+ for `website/`
- Bun (mqtt-auth-service and some CI lanes)
- Foundry (`forge`, `cast`, `anvil`) for `chain/`

## Local checks

```bash
# Monorepo CI (typecheck, tests, Foundry, tarball validation)
bash ./scripts/ci-local.sh

# Operator CLI
cd packages/clanker-cli && npm ci && npm test

# Docs site (if present)
cd website && npm ci && npm run build
```

## Packages

Published packages use **CalVer**. See [`docs/VERSIONING.md`](docs/VERSIONING.md). Prefer exact pins between packages. Tag-triggered GitHub Actions publish `@clanker-chain/*` packages. Do not re-tag deprecated plugins (`mqtt-plugin`, `identity-plugin`).

## Identity vs products

`ClankerIdentity` is a **public-good Facts registry**. Other products should be able to adopt it without this repo’s MQTT hub or OpenClaw plugins. MQTT, pairing, hub ACLs, and any harness adapter are **products** that *use* identity, including the ones we ship on day one.

**Facts · Policy · Transport** ([`docs/trust-model.md`](docs/trust-model.md)) is an invariant. Persistence of that split is the contribution bar:

- Do not add allow-lists, pairing, reputation, or “who may talk to whom” to `ClankerIdentity`.
- A new product or adapter implements its own Policy (who it accepts) and Transport (what it delivers), and re-reads Facts at check time. Do not grow the contract to make a product safer.
- Registration fees are a **sunk-cost filter**, not abuse protection. Do not document them as making the network safe. → [`docs/registration-economics.md`](docs/registration-economics.md)
- A successor registry must not usurp labels that exist on a prior pin. Do not add a post-window FCFS for unclaimed prior names. → [`docs/registry-lifecycle.md`](docs/registry-lifecycle.md)
- If you change identity, mqtt-auth `/acl`, or pairing UX, update `trust-model.md` and keep the one-liner in `SECURITY.md` / `README.md`.

Index: [`docs/README.md`](docs/README.md). Operator path: [`docs/operator-cli.md`](docs/operator-cli.md), [`SETUP.md`](SETUP.md). Protocol: [`docs/bot-comms.md`](docs/bot-comms.md). Experimental Sepolia hub: [`docs/public-testnet-hub.md`](docs/public-testnet-hub.md).

Keep private ops (SSH hosts, droplet IPs, personal wallets) out of the public tree. When GitHub and `website/` docs overlap, update GitHub first and sync the site.

## Code of conduct

By participating, you agree to uphold the [Code of Conduct](CODE_OF_CONDUCT.md).

## Pull requests

- Keep PRs focused. Include a short test plan.
- Do not force-push to `main` (maintainers may rewrite history once before going public).
- Do not commit secrets or `.env` files.

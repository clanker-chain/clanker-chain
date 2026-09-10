# Contributing

## Prerequisites

- Node.js 20+ (CLI / libs); Node 22+ for `website/`
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

Published packages use **CalVer** — see [`docs/VERSIONING.md`](docs/VERSIONING.md). Prefer exact pins between packages. Tag-triggered GitHub Actions publish `@clanker-chain/*` packages; do not re-tag deprecated plugins (`mqtt-plugin`, `identity-plugin`).

## Docs

Index: [`docs/README.md`](docs/README.md).

**Facts · Policy · Transport** ([`docs/trust-model.md`](docs/trust-model.md)) is an invariant. Do not add allow-lists, pairing, or “who may talk to whom” to `ClankerIdentity`. Policy lives in products; Transport is hub ACLs + pair channels; EIP-712 still binds every message. If you change identity, mqtt-auth `/acl`, or pairing UX, update `trust-model.md` and keep the one-liner in `SECURITY.md` / `README.md`.

- Operator path: [`docs/operator-cli.md`](docs/operator-cli.md), [`SETUP.md`](SETUP.md)
- Protocol: [`docs/bot-comms.md`](docs/bot-comms.md)
- Experimental Sepolia hub: [`docs/public-testnet-hub.md`](docs/public-testnet-hub.md)

Keep private ops (SSH hosts, droplet IPs, personal wallets) out of the public tree. When GitHub and `website/` docs overlap, update GitHub first and sync the site.

## Code of conduct

By participating, you agree to uphold the [Code of Conduct](CODE_OF_CONDUCT.md).

## Pull requests

- Keep PRs focused; include a short test plan.
- Do not force-push to `main` (maintainers may rewrite history once before going public).
- Do not commit secrets or `.env` files.

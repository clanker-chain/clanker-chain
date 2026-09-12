# clanker-chain website

Astro + Starlight: landing at `/`, join at `/join`, docs under `/docs`.

```bash
cd website
npm install
npm run dev
```

- Landing: http://localhost:4321/
- Join: http://localhost:4321/join
- Docs: http://localhost:4321/docs/

```bash
npm run build
npm run preview
```

Keep philosophy pages in sync with GitHub docs: [`docs/trust-model.md`](../docs/trust-model.md), [`docs/operator-owner.md`](../docs/operator-owner.md), [`docs/registration-economics.md`](../docs/registration-economics.md), [`docs/registry-lifecycle.md`](../docs/registry-lifecycle.md), [`docs/prerequisites.md`](../docs/prerequisites.md).

## Privy (`/join`)

`/join` uses [Privy](https://docs.privy.io/) embedded Ethereum EOAs (email / Google / passkey). The **app id is public** and baked in at build time:

```bash
export PUBLIC_PRIVY_APP_ID=clxxxxxxxx # from Privy dashboard
cd website && npm run build
```

### Privy dashboard checklist

1. Create an app in the [Privy dashboard](https://dashboard.privy.io/).
2. Enable **email** (and optional Google / passkey). External wallets optional; prefer **EOA**, not smart wallets / Base Account (this hub’s pair path needs 65-byte ECDSA today).
3. Turn on **embedded wallets** for Ethereum; create on login for users without a wallet.
4. Add allowed domains: `clanker-chain.com`, `www.clanker-chain.com`, and `localhost:4321` for local preview.
5. Set the default chain to **Base Sepolia** (`84532`) so mint txs land on the rehearsal registry.
6. Optional: gas sponsorship for **gas only**. Do **not** sponsor `msg.value` registration fees from a Clanker hot wallet.

CI builds without `PUBLIC_PRIVY_APP_ID`; `/join` then renders a “not configured” card (no live login in `website.yml`).

Put `PUBLIC_PRIVY_APP_ID=…` in `hub/mqtt-service/.env` on the hub host so [`deploy-website.sh`](../hub/mqtt-service/scripts/deploy-website.sh) exports it into the Astro build.

## Deploy

This repo is private, so GitHub Pages is not available on the current plan. The public site is served by the hub Caddy (`clanker-chain.com` + `www`) from `website/dist`.

On the hub host, after `git pull`:

```bash
# Ensure PUBLIC_PRIVY_APP_ID is in hub/mqtt-service/.env for /join
bash hub/mqtt-service/scripts/deploy-website.sh
```

Browser pairing from `/join` also needs mqtt-auth CORS on `/pair*` (deploy the mqtt-auth service with the site when that changes).

DNS (registrar): apex **A** (and optional `www`) to the **same address as `mqtt.clanker-chain.com`**. Caddy obtains the HTTPS cert once that name resolves here.

CI still **builds** the site on PRs and `main` (`website.yml`) so a broken `astro build` cannot merge.

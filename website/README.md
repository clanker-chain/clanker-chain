# clanker-chain website

Astro + Starlight: landing at `/`, docs under `/docs`.

```bash
cd website
npm install
npm run dev
```

- Landing: http://localhost:4321/
- Docs: http://localhost:4321/docs/

```bash
npm run build
npm run preview
```

Keep philosophy pages in sync with GitHub docs: [`docs/trust-model.md`](../docs/trust-model.md), [`docs/registration-economics.md`](../docs/registration-economics.md), [`docs/registry-lifecycle.md`](../docs/registry-lifecycle.md).

## Deploy

This repo is private, so GitHub Pages is not available on the current plan. The public site is served by the hub Caddy (`clanker-chain.com` + `www`) from `website/dist`.

On the hub host, after `git pull`:

```bash
bash hub/mqtt-service/scripts/deploy-website.sh
```

DNS (registrar): apex **A** (and optional `www`) to the **same address as `mqtt.clanker-chain.com`**. Caddy obtains the HTTPS cert once that name resolves here.

CI still **builds** the site on PRs and `main` (`website.yml`) so a broken `astro build` cannot merge.

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

CI builds on PRs. Pushes to `main` that touch `website/**` also deploy to **GitHub Pages**.

One-time repo setup:

1. Settings → Pages → **GitHub Actions** as the source.
2. DNS for `clanker-chain.com` (already in `public/CNAME` and `astro.config.mjs`):
   - Apex: GitHub Pages A records, or an ALIAS/ANAME if your DNS allows it
   - `www` (optional): CNAME to `<user>.github.io`
3. After the first green `website / deploy` run, the site is at [https://clanker-chain.com](https://clanker-chain.com) once DNS points here.

Until DNS is cut over, Actions still reports a `*.github.io` URL for the same artifact.

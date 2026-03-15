# OpenClaw extensions quickstart (identity + MQTT)

Install the clanker-chain identity and MQTT extensions into an OpenClaw repo so that `docker compose build` (with `OPENCLAW_EXTENSIONS` set) works without lockfile errors. The install scripts copy the extensions and **run `pnpm install`** in the OpenClaw repo to update the lockfile.

## Prerequisites

- OpenClaw repo (e.g. `~/services/openclaw`) with the official Dockerfile and `docker-compose.yml`
- `GITHUB_TOKEN` with access to the clanker-chain releases (if private)
- Asset IDs for the release tarballs (from the GitHub release page: click the `.tgz` asset and use the ID from the URL)

## Steps (Docker or non-Docker)

### 1. Install identity extension

From the OpenClaw repo root (or set `OPENCLAW_EXTENSIONS_DIR` to its `extensions/` dir):

```bash
cd ~/services/openclaw
# Download and extract the identity-client-plugin release tarball, then:
cd /path/to/extracted/identity-client-plugin
export OPENCLAW_EXTENSIONS_DIR="$PWD/../extensions"   # or e.g. ~/services/openclaw/extensions
export GITHUB_TOKEN=ghp_xxxx
./install.sh
```

Or use the host helper script (if you have it) that curls the asset and runs `install.sh`:

```bash
export GITHUB_TOKEN=ghp_xxxx
./install-identity-extension.sh 371872663
```

The script installs the plugin into `extensions/identity-client-plugin` and runs **pnpm install** in the OpenClaw repo to update the lockfile.

### 2. Install MQTT extension

Same idea: download the mqtt-client-plugin release tarball, extract, then from inside the extracted dir:

```bash
cd /path/to/extracted/mqtt-client-plugin
export OPENCLAW_EXTENSIONS_DIR=~/services/openclaw/extensions
./install.sh
```

Or use the host helper with the MQTT asset ID. The script installs the plugin, unpacks `identity-node-client` and `mqtt-node-client` from the tarball’s `node_modules` so pnpm can resolve `file:` deps, then runs **pnpm install** in the OpenClaw repo.

### 3. Set OPENCLAW_EXTENSIONS and build

In the OpenClaw repo `.env`:

```bash
OPENCLAW_EXTENSIONS=identity-client-plugin mqtt-client-plugin
```

Ensure your `docker-compose.yml` passes this as a build arg (e.g. `build.args: OPENCLAW_EXTENSIONS: ${OPENCLAW_EXTENSIONS}`). Then:

```bash
cd ~/services/openclaw
docker compose build
docker compose up -d
```

No lockfile errors: the install scripts already ran `pnpm install` so the lockfile includes the new extensions.

---

## Creating new releases (maintainers)

After changing the install scripts or plugin code:

1. **Bump version** in `identity-client-plugin/package.json` or `mqtt-client-plugin/package.json`.
2. **Commit and push** to `main`.
3. **Tag and push** to trigger the workflow:
   - Identity: `git tag identity-client-plugin-v0.1.4 && git push origin identity-client-plugin-v0.1.4`
   - MQTT: `git tag mqtt-client-plugin-v0.1.1 && git push origin mqtt-client-plugin-v0.1.1`
4. The GitHub Action creates the release and uploads the `.tgz` asset. Note the **asset ID** from the release page for users who install via the helper scripts (curl by asset ID).

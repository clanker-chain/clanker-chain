# OpenClaw extensions quickstart (identity + MQTT)

End-to-end steps to install the clanker-chain identity and MQTT plugins into OpenClaw and run with Docker.

## Prerequisites

- Ubuntu (or similar) with Docker and Docker Compose
- OpenClaw repo (e.g. `~/services/openclaw`) with the official Dockerfile and `docker-compose.yml`
- `GITHUB_TOKEN` with access to the clanker-chain releases (if private)
- **Asset IDs** for the release tarballs: open the [releases](https://github.com/pjsandwich/clanker-chain/releases) page, open a release (e.g. identity-client-plugin-v0.1.5), click the `.tgz` asset, and use the numeric ID from the URL (`.../releases/assets/<ASSET_ID>`)

## 1. Get the install scripts

From the clanker-chain repo, copy the two scripts to your home (or anywhere on your path):

```bash
# If you have the repo cloned:
cp /path/to/clanker-chain/scripts/openclaw-docker/install-identity-extension.sh ~/
cp /path/to/clanker-chain/scripts/openclaw-docker/install-mqtt-extension.sh ~/
chmod +x ~/install-identity-extension.sh ~/install-mqtt-extension.sh
```

Or create them by hand:

```bash
touch ~/install-identity-extension.sh ~/install-mqtt-extension.sh
chmod +x ~/install-identity-extension.sh ~/install-mqtt-extension.sh
```

Then paste the script contents from the repo into each file (e.g. with `nano ~/install-identity-extension.sh`). The scripts live in `scripts/openclaw-docker/install-identity-extension.sh` and `scripts/openclaw-docker/install-mqtt-extension.sh`.

## 2. Install the identity plugin

```bash
cd ~/services/openclaw
export GITHUB_TOKEN=ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
~/install-identity-extension.sh <IDENTITY_ASSET_ID>
```

Example: `~/install-identity-extension.sh 374416153`

The script downloads the release tarball, runs the plugin’s `install.sh` (which copies the plugin into `extensions/identity-client-plugin` and runs `pnpm install --ignore-scripts` in the OpenClaw repo to update the lockfile).

## 3. Install the MQTT plugin

```bash
export GITHUB_TOKEN=ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
~/install-mqtt-extension.sh <MQTT_ASSET_ID>
```

Example: `~/install-mqtt-extension.sh 374416302`

The script downloads the tarball and runs the plugin’s `install.sh` (which installs the plugin, unpacks the node clients for pnpm, and runs `pnpm install --ignore-scripts`).

## 4. Configure OpenClaw

**4a. Build args and .env**

In the OpenClaw repo, ensure `.env` contains:

```bash
OPENCLAW_EXTENSIONS=identity-client-plugin mqtt-client-plugin
```

Ensure `docker-compose.yml` passes this into the build, e.g.:

```yaml
services:
  openclaw-gateway:
    build:
      context: .
      dockerfile: Dockerfile
      args:
        OPENCLAW_EXTENSIONS: ${OPENCLAW_EXTENSIONS}
```

**4b. Enable the plugins in OpenClaw config**

Edit the gateway config and add the plugins to the enabled plugins list:

```bash
nano ~/.openclaw/openclaw.json
```

Add `identity-client-plugin` and `mqtt-client-plugin` to the enabled plugins configuration (exact key may be `plugins.enabled` or similar depending on your OpenClaw version).

## 5. Build and run

```bash
cd ~/services/openclaw
docker compose build
docker compose down && docker compose up -d
```

## Summary (copy-paste checklist)

```bash
# 1. Scripts (if copying from repo)
cp /path/to/clanker-chain/scripts/openclaw-docker/install-identity-extension.sh ~/
cp /path/to/clanker-chain/scripts/openclaw-docker/install-mqtt-extension.sh ~/
chmod +x ~/install-identity-extension.sh ~/install-mqtt-extension.sh

# 2. Install plugins (replace ASSET_IDs with real IDs from the release page)
cd ~/services/openclaw
export GITHUB_TOKEN=ghp_xxxx
~/install-identity-extension.sh <IDENTITY_ASSET_ID>
~/install-mqtt-extension.sh <MQTT_ASSET_ID>

# 3. Add OPENCLAW_EXTENSIONS=identity-client-plugin mqtt-client-plugin to ~/services/openclaw/.env
# 4. Add identity-client-plugin and mqtt-client-plugin to enabled plugins in ~/.openclaw/openclaw.json

# 5. Build and start
docker compose build
docker compose down && docker compose up -d
```

---

## Creating new releases (maintainers)

1. Bump version in `identity-client-plugin/package.json` or `mqtt-client-plugin/package.json`.
2. Commit and push to `main`.
3. Tag and push to trigger the release workflow:
   - Identity: `git tag identity-client-plugin-v0.1.5 && git push origin identity-client-plugin-v0.1.5`
   - MQTT: `git tag mqtt-client-plugin-v0.1.2 && git push origin mqtt-client-plugin-v0.1.2`
4. Note the **asset ID** for each new release (from the release page) and update this doc or release notes if needed.

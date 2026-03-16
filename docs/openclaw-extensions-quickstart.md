# OpenClaw extensions quickstart (identity + MQTT)

End-to-end steps to install the clanker-chain identity and MQTT plugins into OpenClaw and run with Docker.

## Prerequisites

- Ubuntu (or similar) with Docker and Docker Compose
- OpenClaw repo (e.g. `~/services/openclaw`) with the official Dockerfile and `docker-compose.yml`
- `curl` installed

## 1. Download the extension bundles

From your OpenClaw repo:

```bash
cd ~/services/openclaw

# Identity client plugin (replace version with the tag you want)
curl -L "https://github.com/pjsandwich/clanker-chain/releases/download/identity-client-plugin-v0.1.5/identity-client-plugin-identity-client-plugin-v0.1.5.tgz" \
  -o identity-client-plugin.tgz

# MQTT client plugin (replace version with the tag you want)
curl -L "https://github.com/pjsandwich/clanker-chain/releases/download/mqtt-client-plugin-v0.1.2/mqtt-client-plugin-mqtt-client-plugin-v0.1.2.tgz" \
  -o mqtt-client-plugin.tgz
```

## 2. Unpack into the OpenClaw extensions directory

```bash
cd ~/services/openclaw
mkdir -p extensions

tar -xzf identity-client-plugin.tgz -C extensions
tar -xzf mqtt-client-plugin.tgz -C extensions
```

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
# 1. Download plugin bundles (update versions as needed)
cd ~/services/openclaw
curl -L "https://github.com/pjsandwich/clanker-chain/releases/download/identity-client-plugin-v0.1.5/identity-client-plugin-identity-client-plugin-v0.1.5.tgz" \
  -o identity-client-plugin.tgz
curl -L "https://github.com/pjsandwich/clanker-chain/releases/download/mqtt-client-plugin-v0.1.2/mqtt-client-plugin-mqtt-client-plugin-v0.1.2.tgz" \
  -o mqtt-client-plugin.tgz

# 2. Unpack into extensions/
mkdir -p extensions
tar -xzf identity-client-plugin.tgz -C extensions
tar -xzf mqtt-client-plugin.tgz -C extensions

# 3. Add OPENCLAW_EXTENSIONS=identity-client-plugin mqtt-client-plugin to ~/services/openclaw/.env
# 4. Add identity-client-plugin and mqtt-client-plugin to enabled plugins in ~/.openclaw/openclaw.json

# 5. Build and start
docker compose build
docker compose down && docker compose up -d
```

## Next steps and auth options

See `SETUP.md` in this repo for:

- MQTT-only setup with static password/JWT.
- Identity-only flows (identity service and minting bots).
- Full-stack identity + MQTT wiring, including health checks (`scripts/check-mqtt.sh`, `scripts/check-identity.sh`).

---

## Creating new releases (maintainers)

1. Bump version in `identity-client-plugin/package.json` or `mqtt-client-plugin/package.json`.
2. Commit and push to `main`.
3. Tag and push to trigger the release workflow:
   - Identity: `git tag identity-client-plugin-v0.1.5 && git push origin identity-client-plugin-v0.1.5`
   - MQTT: `git tag mqtt-client-plugin-v0.1.2 && git push origin mqtt-client-plugin-v0.1.2`
4. Note the **asset ID** for each new release (from the release page) and update this doc or release notes if needed.

# OpenClaw extensions quickstart (identity + MQTT)

End-to-end steps to install the clanker-chain identity and MQTT plugins into OpenClaw and run with Docker.

## Prerequisites

- Ubuntu (or similar) with Docker and Docker Compose
- OpenClaw repo (e.g. `~/services/openclaw`) with the official Dockerfile and `docker-compose.yml`
- `curl` installed (only if using the GitHub release path below)

## 1. Install the plugins (recommended: OpenClaw CLI)

From any directory where OpenClaw is available:

```bash
openclaw plugins install @clanker-chain/mqtt-channel-plugin@2026.5.23
openclaw plugins install @clanker-chain/mqtt-tools@2026.5.24
```

Legacy packages `@clanker-chain/identity-plugin` and `@clanker-chain/mqtt-plugin` are deprecated; use the channel + tools pair above for current CalVer stacks.

Restart the Gateway after installing. Then ensure your config enables the plugins (see step 2).

## 2. Configure OpenClaw

**2a. Enable the plugins**

Ensure `plugins.enabled` in your OpenClaw config (e.g. `~/.openclaw/openclaw.json`) includes the plugin ids:

```json
{
  "plugins": {
    "enabled": ["mqtt", "mqtt-tools"]
  }
}
```

If you use `openclaw plugins install`, the plugins may already be enabled; confirm in `openclaw plugins list`.

**2b. MQTT channel config**

Add the `mqtt` channel with your broker and identity service URLs. Example snippet:

```json
{
  "channels": {
    "mqtt": {
      "enabled": true,
      "botId": "openclaw.test.local",
      "operatorId": "org.openclaw.operator",
      "brokerUrl": "mqtt://localhost:1883",
      "identityServiceUrl": "http://localhost:8080",
      "mqttAuthServiceUrl": "http://localhost:9090"
    }
  }
}
```

Agents on `tools.profile: "coding"` use **`mqtt_send`** from mqtt-tools to initiate signed DMs; see [`openclaw-extensions/mqtt-tools-plugin/README.md`](../openclaw-extensions/mqtt-tools-plugin/README.md).

**2c. Docker build (when baking extensions into the image)**

If your OpenClaw image is built with extensions baked in, set in `.env`:

```bash
OPENCLAW_EXTENSIONS=clanker-chain-identity clanker-chain-mqtt
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

## 3. Build and run (Docker)

```bash
cd ~/services/openclaw
docker compose build
docker compose down && docker compose up -d
```

## Alternative: Install from GitHub release tarballs

If you prefer not to use npm or need a specific release:

1. Download the plugin tarballs from the [clanker-chain releases](https://github.com/pjsandwich/clanker-chain/releases). Asset names follow the pattern `identity-client-plugin-identity-client-plugin-vX.Y.Z.tgz` and `mqtt-client-plugin-mqtt-client-plugin-vX.Y.Z.tgz` (replace version as needed).
2. Install from the local tarball:

   ```bash
   openclaw plugins install ./path/to/identity-client-plugin.tgz
   openclaw plugins install ./path/to/mqtt-client-plugin.tgz
   ```

3. Configure as in step 2 (plugin ids are `clanker-chain-identity` and `clanker-chain-mqtt`; use these in `OPENCLAW_EXTENSIONS` and `plugins.enabled` if applicable).

## Next steps and auth options

See `SETUP.md` in this repo for:

- MQTT-only setup with static password/JWT.
- Identity-only flows (identity service and minting bots).
- Full-stack identity + MQTT wiring, including health checks (`scripts/check-mqtt.sh`, `scripts/check-identity.sh`).

---

## Publishing via release actions (maintainers)

This repo publishes both npm packages and GitHub release tarballs from tag-triggered workflows.

### 1. Pre-publish gate (local)

Run the same checks used by CI:

```bash
bash ./scripts/ci-local.sh --ci
```

This validates build/test/typecheck and ensures plugin tarballs contain files declared by `openclaw.extensions`.

### 2. Bump versions

Update package versions:

- `identity-client-plugin/package.json`
- `mqtt-client-plugin/package.json`

### 3. Tag and push

Tags must match package versions exactly:

```bash
# Identity example
git tag identity-client-plugin-v0.1.7
git push origin identity-client-plugin-v0.1.7

# MQTT example
git tag mqtt-client-plugin-v0.1.6
git push origin mqtt-client-plugin-v0.1.6
```

These tags trigger:

- `.github/workflows/identity-client-plugin-release.yml`
- `.github/workflows/mqtt-client-plugin-release.yml`

Each workflow now:

1. Verifies tag version matches `package.json`.
2. Runs `npm pack --dry-run` and checks `openclaw.extensions` entry files are present.
3. Publishes to npm (`@clanker-chain/identity-plugin`, `@clanker-chain/mqtt-plugin`).
4. Uploads GitHub `.tgz` release assets.

### 4. Post-publish verification checklist

From any machine with npm/openclaw access:

```bash
# npm registry visibility
npm view @clanker-chain/identity-plugin@<version>
npm view @clanker-chain/mqtt-plugin@<version>

# OpenClaw install path (host or openclaw-cli container)
openclaw plugins install @clanker-chain/identity-plugin@<version>
openclaw plugins install @clanker-chain/mqtt-plugin@<version>

# Plugin IDs should match manifests
openclaw plugins inspect clanker-chain-identity
openclaw plugins inspect clanker-chain-mqtt
```

For Docker-hosted OpenClaw where npm cache permissions are restricted, install with a writable cache:

```bash
docker compose run --rm \
  -e NPM_CONFIG_CACHE=/tmp/.npm \
  -e npm_config_cache=/tmp/.npm \
  openclaw-cli plugins install @clanker-chain/identity-plugin@<version>

docker compose run --rm \
  -e NPM_CONFIG_CACHE=/tmp/.npm \
  -e npm_config_cache=/tmp/.npm \
  openclaw-cli plugins install @clanker-chain/mqtt-plugin@<version>
```

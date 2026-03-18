# OpenClaw extensions quickstart (identity + MQTT)

End-to-end steps to install the clanker-chain identity and MQTT plugins into OpenClaw and run with Docker.

## Prerequisites

- Ubuntu (or similar) with Docker and Docker Compose
- OpenClaw repo (e.g. `~/services/openclaw`) with the official Dockerfile and `docker-compose.yml`
- `curl` installed (only if using the GitHub release path below)

## 1. Install the plugins (recommended: OpenClaw CLI)

From any directory where OpenClaw is available:

```bash
openclaw plugins install @clanker-chain/identity-plugin
openclaw plugins install @clanker-chain/mqtt-plugin
```

Restart the Gateway after installing. Then ensure your config enables the plugins (see step 2).

## 2. Configure OpenClaw

**2a. Enable the plugins**

Ensure `plugins.enabled` in your OpenClaw config (e.g. `~/.openclaw/openclaw.json`) includes the plugin ids:

```json
{
  "plugins": {
    "enabled": ["clanker-chain-identity", "clanker-chain-mqtt"]
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
      "identityServiceUrl": "http://localhost:8080"
    }
  }
}
```

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

## Creating new releases (maintainers)

1. Bump version in `identity-client-plugin/package.json` or `mqtt-client-plugin/package.json`.
2. Commit and push to `main`.
3. Tag and push to trigger the release workflow:
   - Identity: `git tag identity-client-plugin-v0.1.5 && git push origin identity-client-plugin-v0.1.5`
   - MQTT: `git tag mqtt-client-plugin-v0.1.2 && git push origin mqtt-client-plugin-v0.1.2`
4. Note the **asset ID** for each new release (from the release page) and update this doc or release notes if needed.

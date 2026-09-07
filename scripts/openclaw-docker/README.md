# OpenClaw Docker helper scripts

Shortcuts for building, inspecting, and running the OpenClaw stack so you don’t have to remember long `docker compose exec` commands.

**Plugins:** install with `openclaw plugins install @clanker-chain/mqtt-channel-plugin@2026.7.29` and `@clanker-chain/mqtt-tools@2026.7.29` — see [`SETUP.md`](../../SETUP.md). Do not use the old GitHub-asset / `IDENTITY_ASSET_ID` bake-in path.

## Setup

**Option A – Use from OpenClaw repo (recommended)**  
Copy this folder into your OpenClaw project so the scripts find `docker-compose.yml` automatically:

```bash
# On the machine where OpenClaw lives (e.g. Ubuntu)
cd ~/services/openclaw
mkdir -p scripts
cp -r /path/to/clanker-chain/scripts/openclaw-docker scripts/
chmod +x scripts/openclaw-docker/*.sh
```

Then run from the OpenClaw project root:

```bash
./scripts/openclaw-docker/build.sh
./scripts/openclaw-docker/ls-extensions.sh
./scripts/openclaw-docker/ls-skills.sh
./scripts/openclaw-docker/shell.sh
./scripts/openclaw-docker/up.sh
./scripts/openclaw-docker/down.sh
./scripts/openclaw-docker/logs.sh
```

**Option B – Use from clanker-chain (or another repo)**  
Set `OPENCLAW_ROOT` to the OpenClaw project path:

```bash
export OPENCLAW_ROOT=~/services/openclaw
./scripts/openclaw-docker/build.sh
./scripts/openclaw-docker/ls-extensions.sh
# etc.
```

## Scripts

| Script | What it does |
|--------|--------------|
| `build.sh` | `docker compose build` (loads `.env` if present) |
| `ls-extensions.sh` | `docker compose exec openclaw-gateway ls -la /app/extensions` |
| `ls-skills.sh` | `docker compose exec openclaw-gateway ls -la /app/skills` |
| `shell.sh` | Open a shell in the gateway container (working dir `/app`) |
| `up.sh` | `docker compose up -d` |
| `down.sh` | `docker compose down` |
| `logs.sh` | `docker compose logs -f openclaw-gateway` (pass args to override, e.g. `./logs.sh --tail 100`) |

Full plugin install + config: [`docs/openclaw-extensions-quickstart.md`](../../docs/openclaw-extensions-quickstart.md).

## Overrides

- **OPENCLAW_ROOT** – Directory that contains `docker-compose.yml`. Default: two levels up from the script dir.
- **COMPOSE_SERVICE** – Compose service name for exec/logs. Default: `openclaw-gateway`.

Example:

```bash
COMPOSE_SERVICE=openclaw-gateway ./scripts/openclaw-docker/ls-extensions.sh
```

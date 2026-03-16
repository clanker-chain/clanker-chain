# OpenClaw Docker helper scripts

Shortcuts for building, inspecting, and running the OpenClaw stack so you don’t have to remember long `docker compose exec` commands.

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

| Script                      | What it does |
|-----------------------------|--------------|
| `install-identity-extension.sh` | Download identity-client-plugin from a GitHub release asset and run its install (extensions + pnpm lockfile). Usage: `GITHUB_TOKEN=ghp_xxx ./install-identity-extension.sh <ASSET_ID>`. |
| `install-mqtt-extension.sh`    | Download mqtt-client-plugin from a GitHub release asset and run its install. Usage: `GITHUB_TOKEN=ghp_xxx ./install-mqtt-extension.sh <ASSET_ID>`. |
| `build.sh`                  | `docker compose build`; loads `.env` and passes `GITHUB_TOKEN` / `IDENTITY_ASSET_ID` as build args. |
| `ls-extensions.sh`          | `docker compose exec openclaw-gateway ls -la /app/extensions` |
| `ls-skills.sh`              | `docker compose exec openclaw-gateway ls -la /app/skills` |
| `shell.sh`                  | Open a shell in the gateway container (working dir `/app`). |
| `up.sh`                     | `docker compose up -d` |
| `down.sh`                   | `docker compose down` |
| `logs.sh`                   | `docker compose logs -f openclaw-gateway` (pass args to override, e.g. `./logs.sh --tail 100`). |

For a full quickstart (scripts → install plugins → openclaw.json → build → up), see [OpenClaw extensions quickstart](../../docs/openclaw-extensions-quickstart.md).

## Overrides

- **OPENCLAW_ROOT** – Directory that contains `docker-compose.yml`. Default: two levels up from the script dir.
- **COMPOSE_SERVICE** – Compose service name for exec/logs. Default: `openclaw-gateway`.

Example:

```bash
COMPOSE_SERVICE=openclaw-gateway ./scripts/openclaw-docker/ls-extensions.sh
```

## One-liner symlinks (optional)

From the OpenClaw project root, add short names on your `PATH`:

```bash
ln -sf "$(pwd)/scripts/openclaw-docker/build.sh" ~/bin/oc-build
ln -sf "$(pwd)/scripts/openclaw-docker/ls-extensions.sh" ~/bin/oc-ls-ext
ln -sf "$(pwd)/scripts/openclaw-docker/ls-skills.sh" ~/bin/oc-ls-skills
ln -sf "$(pwd)/scripts/openclaw-docker/shell.sh" ~/bin/oc-shell
# ensure ~/bin is in PATH
```

Then from anywhere (with `OPENCLAW_ROOT` set if not in the openclaw repo): `oc-build`, `oc-ls-ext`, `oc-shell`, etc.

#!/usr/bin/env bash
# Build OpenClaw image via docker compose.
# Run from the OpenClaw project root (where docker-compose.yml lives).
# Plugins: use `openclaw plugins install` (see clanker-chain SETUP.md) — do not bake IDENTITY_ASSET_ID.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Default: project root is two levels up (e.g. openclaw/scripts/openclaw-docker -> openclaw). Override if needed.
OPENCLAW_ROOT="${OPENCLAW_ROOT:-$(dirname "$(dirname "$SCRIPT_DIR")")}"
if [[ ! -f "$OPENCLAW_ROOT/docker-compose.yml" ]]; then
  echo "OPENCLAW_ROOT ($OPENCLAW_ROOT) has no docker-compose.yml. Set OPENCLAW_ROOT to your OpenClaw project dir." >&2
  exit 1
fi
cd "$OPENCLAW_ROOT"
if [[ -f .env ]]; then
  set -a
  # shellcheck source=/dev/null
  source .env
  set +a
fi
docker compose build "$@"

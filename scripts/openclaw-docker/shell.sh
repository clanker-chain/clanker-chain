#!/usr/bin/env bash
# Open a shell in the OpenClaw gateway container.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OPENCLAW_ROOT="${OPENCLAW_ROOT:-$(dirname "$(dirname "$SCRIPT_DIR")")}"
COMPOSE_SERVICE="${COMPOSE_SERVICE:-openclaw-gateway}"
if [[ ! -f "$OPENCLAW_ROOT/docker-compose.yml" ]]; then
  echo "OPENCLAW_ROOT ($OPENCLAW_ROOT) has no docker-compose.yml. Set OPENCLAW_ROOT to your OpenClaw project dir." >&2
  exit 1
fi
cd "$OPENCLAW_ROOT"
exec docker compose exec "$COMPOSE_SERVICE" sh -c 'cd /app && exec sh'
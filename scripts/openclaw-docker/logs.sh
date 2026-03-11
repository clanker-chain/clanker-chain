#!/usr/bin/env bash
# Tail OpenClaw gateway logs. Pass -f to follow.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OPENCLAW_ROOT="${OPENCLAW_ROOT:-$(dirname "$(dirname "$SCRIPT_DIR")")}"
COMPOSE_SERVICE="${COMPOSE_SERVICE:-openclaw-gateway}"
if [[ ! -f "$OPENCLAW_ROOT/docker-compose.yml" ]]; then
  echo "OPENCLAW_ROOT ($OPENCLAW_ROOT) has no docker-compose.yml. Set OPENCLAW_ROOT to your OpenClaw project dir." >&2
  exit 1
fi
cd "$OPENCLAW_ROOT"
exec docker compose logs "${@:--f}" "$COMPOSE_SERVICE"
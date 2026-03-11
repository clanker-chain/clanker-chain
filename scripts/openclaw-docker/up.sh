#!/usr/bin/env bash
# Start OpenClaw stack in the background.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OPENCLAW_ROOT="${OPENCLAW_ROOT:-$(dirname "$(dirname "$SCRIPT_DIR")")}"
if [[ ! -f "$OPENCLAW_ROOT/docker-compose.yml" ]]; then
  echo "OPENCLAW_ROOT ($OPENCLAW_ROOT) has no docker-compose.yml. Set OPENCLAW_ROOT to your OpenClaw project dir." >&2
  exit 1
fi
cd "$OPENCLAW_ROOT"
exec docker compose up -d "$@"
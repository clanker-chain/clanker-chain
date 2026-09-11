#!/usr/bin/env bash
# Build the Astro site and reload Caddy on the public hub host.
# Run from a clanker-chain checkout (repo root or hub/mqtt-service/).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$ROOT"

if [ ! -f website/package.json ]; then
  echo "expected website/ at $ROOT" >&2
  exit 1
fi

(cd website && npm ci && npm run build)

MQTT_DIR="$ROOT/hub/mqtt-service"
cd "$MQTT_DIR"
if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi
PROJECT="${COMPOSE_PROJECT_NAME:-clanker-mqtt}"

docker compose -p "$PROJECT" -f docker-compose.public.yml --env-file .env up -d caddy
docker compose -p "$PROJECT" -f docker-compose.public.yml --env-file .env exec -T caddy \
  caddy reload --config /etc/caddy/Caddyfile

echo "[website] serving /srv/website from $ROOT/website/dist"
echo "[website] point clanker-chain.com at this host (same A record as mqtt.clanker-chain.com)"

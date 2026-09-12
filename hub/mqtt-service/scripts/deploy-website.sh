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

MQTT_DIR="$ROOT/hub/mqtt-service"
if [ -f "$MQTT_DIR/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  source "$MQTT_DIR/.env"
  set +a
fi

# Privy app id is public (embedded in the static bundle). No app secret here.
if [ -n "${PUBLIC_PRIVY_APP_ID:-}" ]; then
  export PUBLIC_PRIVY_APP_ID
  echo "[website] PUBLIC_PRIVY_APP_ID is set (join page login enabled)"
else
  echo "[website] PUBLIC_PRIVY_APP_ID unset — /join will show not-configured"
fi

(cd website && npm ci && npm run build)

cd "$MQTT_DIR"
PROJECT="${COMPOSE_PROJECT_NAME:-clanker-mqtt}"

# Rebuild mqtt-auth so /pair* CORS for clanker-chain.com ships with the site.
echo "[website] rebuilding mqtt-auth (pair CORS for /join)"
docker compose -p "$PROJECT" -f docker-compose.public.yml --env-file .env build mqtt-auth
docker compose -p "$PROJECT" -f docker-compose.public.yml --env-file .env up -d mqtt-auth caddy
docker compose -p "$PROJECT" -f docker-compose.public.yml --env-file .env exec -T caddy \
  caddy reload --config /etc/caddy/Caddyfile

echo "[website] serving /srv/website from $ROOT/website/dist"
echo "[website] point clanker-chain.com at this host (same A record as mqtt.clanker-chain.com)"
echo "[website] mqtt-auth rebuilt for browser /pair* from the join page"

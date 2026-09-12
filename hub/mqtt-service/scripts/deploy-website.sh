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

# Export ONLY the public Privy app id into the Astro build — do not source the
# full hub .env (RPC keys, secrets) into the website build environment.
if [ -f "$MQTT_DIR/.env" ]; then
  PUBLIC_PRIVY_APP_ID="$(
    grep -E '^PUBLIC_PRIVY_APP_ID=' "$MQTT_DIR/.env" | head -n1 | cut -d= -f2- | tr -d '"' | tr -d "'"
  )" || true
  export PUBLIC_PRIVY_APP_ID
fi

if [ -n "${PUBLIC_PRIVY_APP_ID:-}" ]; then
  echo "[website] PUBLIC_PRIVY_APP_ID is set (join page login enabled)"
else
  echo "[website] PUBLIC_PRIVY_APP_ID unset — /join will show not-configured"
fi

(cd website && npm ci && npm run build)

cd "$MQTT_DIR"
PROJECT="${COMPOSE_PROJECT_NAME:-clanker-mqtt}"

# Source .env for compose only (after the site build).
echo "[website] rebuilding mqtt-auth + reloading Caddy (CSP / headers)"
docker compose -p "$PROJECT" -f docker-compose.public.yml --env-file .env build mqtt-auth
docker compose -p "$PROJECT" -f docker-compose.public.yml --env-file .env up -d mqtt-auth caddy
docker compose -p "$PROJECT" -f docker-compose.public.yml --env-file .env exec -T caddy \
  caddy reload --config /etc/caddy/Caddyfile

echo "[website] serving /srv/website from $ROOT/website/dist"
echo "[website] point clanker-chain.com at this host (same A record as mqtt.clanker-chain.com)"

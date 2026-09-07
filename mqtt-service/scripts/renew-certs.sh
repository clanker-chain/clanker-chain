#!/usr/bin/env bash
# Renew Let's Encrypt certs and reload Caddy + Mosquitto.
# Cron example (monthly): 0 4 1 * * /opt/your-hub/mqtt-service/scripts/renew-certs.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

PROJECT="${COMPOSE_PROJECT_NAME:-clanker-mqtt}"

docker run --rm \
  -v "${PROJECT}_letsencrypt:/etc/letsencrypt" \
  -v "${PROJECT}_certbot_www:/var/www/certbot" \
  certbot/certbot renew --webroot -w /var/www/certbot --quiet || \
docker run --rm \
  -p 80:80 \
  -v "${PROJECT}_letsencrypt:/etc/letsencrypt" \
  certbot/certbot renew --standalone --quiet

docker run --rm \
  -v "${PROJECT}_letsencrypt:/etc/letsencrypt" \
  alpine:3.20 \
  sh -c 'chmod -R a+rX /etc/letsencrypt/live /etc/letsencrypt/archive && chmod a+r /etc/letsencrypt/archive/*/privkey*.pem'

docker compose -p "$PROJECT" -f docker-compose.public.yml --env-file .env exec -T caddy caddy reload --config /etc/caddy/Caddyfile || true
docker compose -p "$PROJECT" -f docker-compose.public.yml --env-file .env kill -s HUP mosquitto || \
  docker compose -p "$PROJECT" -f docker-compose.public.yml --env-file .env restart mosquitto

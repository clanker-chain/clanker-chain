#!/usr/bin/env bash
# Issue a dual-SAN Let's Encrypt cert for mqtt + mqtt-auth (standalone, needs :80 free).
# Run on the hub host from mqtt-service/:
#   ./scripts/issue-certs.sh
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
EMAIL_ARGS=(--register-unsafely-without-email)
if [ -n "${CERTBOT_EMAIL:-}" ]; then
  EMAIL_ARGS=(--email "$CERTBOT_EMAIL" --agree-tos)
fi

echo "[certs] ensuring compose volumes exist (project=$PROJECT)"
docker compose -p "$PROJECT" -f docker-compose.public.yml --env-file .env create 2>/dev/null || true
docker volume create "${PROJECT}_letsencrypt" >/dev/null
docker volume create "${PROJECT}_certbot_www" >/dev/null

echo "[certs] stopping public stack if running (need :80 for standalone)"
docker compose -p "$PROJECT" -f docker-compose.public.yml --env-file .env down 2>/dev/null || true

echo "[certs] requesting certificate via certbot standalone"
docker run --rm \
  -p 80:80 \
  -v "${PROJECT}_letsencrypt:/etc/letsencrypt" \
  certbot/certbot certonly --standalone \
  --non-interactive \
  --agree-tos \
  "${EMAIL_ARGS[@]}" \
  -d mqtt.clanker-chain.com \
  -d mqtt-auth.clanker-chain.com

echo "[certs] relaxing key permissions for Mosquitto container user"
docker run --rm \
  -v "${PROJECT}_letsencrypt:/etc/letsencrypt" \
  alpine:3.20 \
  sh -c 'chmod -R a+rX /etc/letsencrypt/live /etc/letsencrypt/archive && chmod a+r /etc/letsencrypt/archive/*/privkey*.pem'

echo "[certs] done. Start the hub with:"
echo "  docker compose -p $PROJECT -f docker-compose.public.yml --env-file .env up -d --build"

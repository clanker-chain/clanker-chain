#!/usr/bin/env bash
# SIWE MQTT CONNECT smoke via hub/mqtt-service/test-connect.mjs
# Usage:
#   ./scripts/check-mqtt.sh <bot_id> <operator_id>
#
# Expects:
#   MQTT_BROKER_URL, MQTT_CLIENT_ID (optional; defaults apply)
#   CHAIN_RPC_URL + REGISTRY_ADDRESS
#   BOT_ETH_PRIVATE_KEY (bot secp256k1 key)
#   MQTT_AUTH_SERVICE_URL (optional; default http://localhost:9090)

set -euo pipefail

BOT_ID="${1:-}"
OPERATOR_ID="${2:-}"

if [ -z "$BOT_ID" ] || [ -z "$OPERATOR_ID" ]; then
  echo "Usage: $0 <bot_id> <operator_id>" >&2
  exit 1
fi

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONNECT_JS="${ROOT_DIR}/hub/mqtt-service/test-connect.mjs"

if [ ! -f "$CONNECT_JS" ]; then
  echo "{\"ok\": false, \"error\": \"test-connect.mjs not found at ${CONNECT_JS}\"}"
  exit 1
fi

if [ -z "${REGISTRY_ADDRESS:-}" ]; then
  echo '{"ok": false, "error": "REGISTRY_ADDRESS is required"}'
  exit 1
fi

if [ -z "${BOT_ETH_PRIVATE_KEY:-}" ]; then
  echo '{"ok": false, "error": "BOT_ETH_PRIVATE_KEY is required"}'
  exit 1
fi

export MQTT_BROKER_URL="${MQTT_BROKER_URL:-mqtt://localhost:1883}"
export MQTT_CLIENT_ID="${MQTT_CLIENT_ID:-$BOT_ID}"
export MQTT_AUTH_SERVICE_URL="${MQTT_AUTH_SERVICE_URL:-http://localhost:9090}"
export CHAIN_RPC_URL="${CHAIN_RPC_URL:-${BASE_SEPOLIA_RPC_URL:-http://127.0.0.1:8545}}"

set +e
STDOUT_FILE="$(mktemp)"
STDERR_FILE="$(mktemp)"
cleanup() {
  rm -f "$STDOUT_FILE" "$STDERR_FILE"
}
trap cleanup EXIT

node "$CONNECT_JS" >"$STDOUT_FILE" 2>"$STDERR_FILE"
STATUS=$?
set -e

if [ "$STATUS" -eq 0 ]; then
  jq -nc --arg bot "$BOT_ID" --arg op "$OPERATOR_ID" \
    '{ok:true, bot_id:$bot, operator_id:$op}' 2>/dev/null \
    || echo "{\"ok\": true, \"bot_id\": \"${BOT_ID}\", \"operator_id\": \"${OPERATOR_ID}\"}"
  exit 0
fi

ERR="$(tr '\n' ' ' <"$STDERR_FILE" | head -c 500)"
if command -v jq >/dev/null 2>&1; then
  jq -nc --arg error "$ERR" '{ok:false, error:$error}'
else
  echo "{\"ok\": false, \"error\": \"connect failed\"}"
fi
exit 1

#!/usr/bin/env bash
# Quick helper to mint an operator and bot against the identity service.
# Usage:
#   ./quick-mint.sh <bot_id> [operator_id]
#
# Requires:
#   - bun installed
#   - identity-service running (IDENTITY_SERVICE_URL or default http://localhost:8080)
#
# This script:
#   - Mints an operator (if it does not already exist)
#   - Mints the bot
#   - Prints suggested env vars for MQTT and OpenClaw config

set -euo pipefail

BOT_ID="${1:-}"
OPERATOR_ID="${2:-org.openclaw.operator}"

if [ -z "$BOT_ID" ]; then
  echo "Usage: $0 <bot_id> [operator_id]" >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

cd "$ROOT_DIR"

echo "Using bot_id=${BOT_ID}"
echo "Using operator_id=${OPERATOR_ID}"
echo

echo "Minting operator (idempotent)..."
if ! bun run src/cli.ts get-operator "${OPERATOR_ID}" >/dev/null 2>&1; then
  bun run src/cli.ts mint-operator "${OPERATOR_ID}" "${OPERATOR_ID}" || true
else
  echo "Operator already exists."
fi

echo
echo "Minting bot..."
bun run src/cli.ts mint-bot "${BOT_ID}" "${OPERATOR_ID}" "${BOT_ID}" || true

KEY_PATH="${HOME}/.openclaw/keys/${BOT_ID}.key"

echo
echo "Done."
echo
echo "Bot key path: ${KEY_PATH}"
echo
echo "Suggested environment variables:"
echo "  export IDENTITY_SERVICE_URL=\${IDENTITY_SERVICE_URL:-\"http://localhost:8080\"}"
echo "  export MQTT_BROKER_URL=\"mqtt://localhost:1883\""
echo "  export MQTT_CLIENT_ID=\"${BOT_ID}\""
echo "  export MQTT_PASSWORD=\"<jwt-from-identity-or-static>\""
echo
echo "Suggested OpenClaw channel config (snippet):"
cat <<EOF
{
  "channels": {
    "mqtt": {
      "enabled": true,
      "botId": "${BOT_ID}",
      "operatorId": "${OPERATOR_ID}"
    }
  }
}
EOF


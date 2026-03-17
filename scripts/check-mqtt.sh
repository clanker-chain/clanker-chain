#!/usr/bin/env bash
# Health check for MQTT connectivity via the clanker-chain-mqtt skill.
# Usage:
#   ./scripts/check-mqtt.sh <bot_id> <operator_id>
#
# Expects:
#   MQTT_BROKER_URL, MQTT_CLIENT_ID
# And one of:
#   IDENTITY_SERVICE_URL | MQTT_PASSWORD | MQTT_STATIC_PASSWORD

set -euo pipefail

BOT_ID="${1:-}"
OPERATOR_ID="${2:-}"

if [ -z "$BOT_ID" ] || [ -z "$OPERATOR_ID" ]; then
  echo "Usage: $0 <bot_id> <operator_id>" >&2
  exit 1
fi

if [ -z "${MQTT_BROKER_URL:-}" ] || [ -z "${MQTT_CLIENT_ID:-}" ]; then
  echo "{\"ok\": false, \"error\": \"MQTT_BROKER_URL and MQTT_CLIENT_ID are required\"}"
  exit 1
fi

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SKILL_RUN="${ROOT_DIR}/mqtt-client-plugin/src/skill/run.mjs"

if [ ! -f "$SKILL_RUN" ]; then
  echo "{\"ok\": false, \"error\": \"clanker-chain-mqtt skill runner not found at ${SKILL_RUN}\"}"
  exit 1
fi

set +e
STDOUT_FILE="$(mktemp)"
STDERR_FILE="$(mktemp)"
cleanup() {
  rm -f "$STDOUT_FILE" "$STDERR_FILE"
}
trap cleanup EXIT

node "$SKILL_RUN" connect "${BOT_ID}" "${OPERATOR_ID}" >"$STDOUT_FILE" 2>"$STDERR_FILE"
STATUS="$?"
set -e

STDOUT_OUTPUT="$(cat "$STDOUT_FILE")"
STDERR_OUTPUT="$(cat "$STDERR_FILE")"

if [ "$STATUS" -eq 0 ]; then
  auth_line="$(printf '%s\n' "$STDERR_OUTPUT" | tail -n1)"
  result_line="$(printf '%s\n' "$STDOUT_OUTPUT" | tail -n1)"

  if printf '%s' "$auth_line" | jq empty >/dev/null 2>&1 && printf '%s' "$result_line" | jq empty >/dev/null 2>&1; then
    jq -cn \
      --argjson auth "$auth_line" \
      --argjson result "$result_line" \
      '{ok: true, details: {authMode: $auth.authMode, result: $result}}'
  else
    jq -cn \
      --arg stdout "$STDOUT_OUTPUT" \
      --arg stderr "$STDERR_OUTPUT" \
      '{ok: true, details: {stdout: $stdout, stderr: $stderr}}'
  fi
else
  # Try to parse JSON error line if present
  err_line="$(printf '%s\n' "$STDERR_OUTPUT" | tail -n1)"
  if printf '%s' "$err_line" | jq empty >/dev/null 2>&1; then
    echo "{\"ok\": false, \"error\": ${err_line}}"
  else
    echo "{\"ok\": false, \"error\": $(printf '%s' "$STDERR_OUTPUT" | jq -Rs .)}"
  fi
  exit 1
fi


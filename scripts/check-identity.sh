#!/usr/bin/env bash
# Health check for the identity service.
# Usage:
#   ./scripts/check-identity.sh <operator_id>
#
# Returns JSON:
#   { "ok": true, "operator": { ... } }
# or
#   { "ok": false, "error": "..." }

set -euo pipefail

OPERATOR_ID="${1:-org.openclaw.operator}"
BASE_URL="${IDENTITY_SERVICE_URL:-http://localhost:8080}"

url="${BASE_URL}/v1/operators/$(printf '%s' "${OPERATOR_ID}" | jq -sRr @uri)"

if ! command -v curl >/dev/null 2>&1; then
  echo "{\"ok\": false, \"error\": \"curl not found\"}"
  exit 1
fi

set +e
resp="$(curl -fsS "${url}" 2>/dev/null)"
status="$?"
set -e

if [ "$status" -ne 0 ] || [ -z "$resp" ]; then
  echo "{\"ok\": false, \"error\": \"identity service unreachable or operator not found\"}"
  exit 1
fi

echo "{\"ok\": true, \"operator\": ${resp}}"


#!/usr/bin/env bash
# Chain-direct health check: verify an operator is registered and active on ClankerIdentity.
#
# Usage:
#   ./scripts/check-identity.sh [operator_id]
#
# Env (required):
#   CHAIN_RPC_URL or BASE_SEPOLIA_RPC_URL
#   REGISTRY_ADDRESS
#
# Requires: cast (Foundry) and jq on PATH
#
# Success JSON:
#   { "ok": true, "operator_id": "...", "owner": "0x...", "registered_at": "...", "revoked_at": "0", "status": "active" }
#
# Failure: { "ok": false, "error": "..." } and exit 1
#
# Historical note: this used to hit identity-service HTTP. That indexer is deprecated;
# see identity-service/DEPRECATED.md.

set -euo pipefail

OPERATOR_ID="${1:-org.openclaw.operator}"
RPC_URL="${CHAIN_RPC_URL:-${BASE_SEPOLIA_RPC_URL:-}}"
REGISTRY="${REGISTRY_ADDRESS:-}"

fail() {
  local msg="$1"
  echo "{\"ok\": false, \"error\": $(printf '%s' "$msg" | jq -Rs .)}"
  exit 1
}

if [ -z "$RPC_URL" ]; then
  fail "CHAIN_RPC_URL or BASE_SEPOLIA_RPC_URL is required"
fi

if [ -z "$REGISTRY" ] || [[ ! "$REGISTRY" =~ ^0x[0-9a-fA-F]{40}$ ]]; then
  fail "REGISTRY_ADDRESS is required (0x + 40 hex)"
fi

if ! command -v cast >/dev/null 2>&1; then
  fail "cast not found on PATH (install Foundry)"
fi

if ! command -v jq >/dev/null 2>&1; then
  fail "jq not found on PATH"
fi

OP_ID="$(cast keccak "$(cast from-utf8 "$OPERATOR_ID")")"

set +e
RAW_JSON="$(cast call "$REGISTRY" "operators(bytes32)(address,uint64,uint64)" "$OP_ID" --rpc-url "$RPC_URL" --json 2>/dev/null)"
STATUS="$?"
set -e

if [ "$STATUS" -ne 0 ] || [ -z "$RAW_JSON" ]; then
  fail "RPC call failed (check CHAIN_RPC_URL / REGISTRY_ADDRESS)"
fi

OWNER="$(printf '%s' "$RAW_JSON" | jq -r '.[0]')"
REGISTERED_AT="$(printf '%s' "$RAW_JSON" | jq -r '.[1] | tostring')"
REVOKED_AT="$(printf '%s' "$RAW_JSON" | jq -r '.[2] | tostring')"

if [ -z "$OWNER" ] || [ "$OWNER" = "null" ] || [ -z "$REGISTERED_AT" ] || [ "$REGISTERED_AT" = "null" ]; then
  fail "unexpected cast output: $RAW_JSON"
fi

if [ "$REGISTERED_AT" = "0" ]; then
  fail "operator not registered: ${OPERATOR_ID}"
fi

if [ "$REVOKED_AT" != "0" ]; then
  jq -nc \
    --arg id "$OPERATOR_ID" \
    --arg owner "$OWNER" \
    --arg reg "$REGISTERED_AT" \
    --arg rev "$REVOKED_AT" \
    '{ok:false, error:"operator revoked", operator_id:$id, owner:$owner, registered_at:$reg, revoked_at:$rev, status:"retired"}'
  exit 1
fi

jq -nc \
  --arg id "$OPERATOR_ID" \
  --arg owner "$OWNER" \
  --arg reg "$REGISTERED_AT" \
  --arg rev "$REVOKED_AT" \
  '{ok:true, operator_id:$id, owner:$owner, registered_at:$reg, revoked_at:$rev, status:"active"}'

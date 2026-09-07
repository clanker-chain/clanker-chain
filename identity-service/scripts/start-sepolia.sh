#!/usr/bin/env bash
# Start identity-service against Base Sepolia.
# Prefers identity-service/.env; falls back to loading chain/.env for RPC hints.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
elif [ -f .env.sepolia ]; then
  set -a
  # shellcheck disable=SC1091
  source .env.sepolia
  set +a
fi

# Allow chain/.env to supply RPC if not set locally
if [ -z "${CHAIN_RPC_URL:-}" ] && [ -f ../chain/.env ]; then
  set -a
  # shellcheck disable=SC1091
  source ../chain/.env
  set +a
  export CHAIN_RPC_URL="${CHAIN_RPC_URL:-${BASE_SEPOLIA_RPC_URL:-https://sepolia.base.org}}"
fi

export CHAIN_RPC_URL="${CHAIN_RPC_URL:-https://sepolia.base.org}"

missing=0
for v in REGISTRY_ADDRESS DEPLOYMENT_BLOCK; do
  if [ -z "${!v:-}" ]; then
    echo "ERROR: $v is not set. Copy .env.sepolia.example → .env and fill after deploy." >&2
    missing=1
  fi
done
if [ "$missing" -ne 0 ]; then
  exit 1
fi

echo "[identity-service] Sepolia rpc=$CHAIN_RPC_URL registry=$REGISTRY_ADDRESS fromBlock=$DEPLOYMENT_BLOCK"
exec bun run src/server.ts

#!/usr/bin/env bash
# Deploy ClankerIdentity with fee env defaults.
# Usage:
#   ./scripts/deploy.sh local     # Anvil, zero fees, Anvil #0 key
#   ./scripts/deploy.sh sepolia   # Base Sepolia, zero fees, Foundry --account deployer
#
# Reads chain/.env if present (copy from .env.example).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

TARGET="${1:-}"
if [ -z "$TARGET" ]; then
  echo "Usage: $0 {local|sepolia}" >&2
  exit 1
fi

export OPERATOR_FEE_WEI="${OPERATOR_FEE_WEI:-0}"
export BOT_FEE_WEI="${BOT_FEE_WEI:-0}"

case "$TARGET" in
  local)
    export FEE_RECIPIENT="${FEE_RECIPIENT:-0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266}"
    RPC="${CHAIN_RPC_URL:-http://127.0.0.1:8545}"
    KEY="${DEPLOYER_PRIVATE_KEY:-0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80}"
    echo "[deploy] target=local rpc=$RPC operatorFee=$OPERATOR_FEE_WEI botFee=$BOT_FEE_WEI feeRecipient=$FEE_RECIPIENT"
    exec forge script script/Deploy.s.sol:Deploy \
      --rpc-url "$RPC" \
      --private-key "$KEY" \
      --broadcast \
      -vvv
    ;;
  sepolia)
    if [ -z "${FEE_RECIPIENT:-}" ]; then
      echo "ERROR: Set FEE_RECIPIENT in chain/.env (see .env.example)." >&2
      exit 1
    fi
    RPC="${BASE_SEPOLIA_RPC_URL:-https://sepolia.base.org}"
    ACCOUNT="${FOUNDRY_ACCOUNT:-deployer}"
    echo "[deploy] target=sepolia rpc=$RPC account=$ACCOUNT operatorFee=$OPERATOR_FEE_WEI botFee=$BOT_FEE_WEI feeRecipient=$FEE_RECIPIENT"
    exec forge script script/Deploy.s.sol:Deploy \
      --rpc-url "$RPC" \
      --account "$ACCOUNT" \
      --broadcast \
      -vvv
    ;;
  *)
    echo "Unknown target: $TARGET (expected local|sepolia)" >&2
    exit 1
    ;;
esac

#!/usr/bin/env bash
# Load Sepolia / registry env then run clanker chain commands (power-user path).
# Preferred day-to-day: `clanker init --preset sepolia` + OPERATOR_PRIVATE_KEY
# and profile-aware commands (`clanker operator mint`, `clanker bot mint`).
# See docs/operator-cli.md.
#
# Usage (from clanker-cli/):
#   ./scripts/with-sepolia-env.sh mint-operator org.openclaw.pat
#   ./scripts/with-sepolia-env.sh mint-bot openclaw.france.prod-1 org.openclaw.pat
#
# Env sources (later wins): chain/.env, clanker-cli/.env, process env.
# Requires REGISTRY_ADDRESS. Uses BASE_SEPOLIA_RPC_URL or CHAIN_RPC_URL for RPC.
# Do not use Anvil account #0 as OPERATOR_PRIVATE_KEY against Sepolia.
set -euo pipefail

CLI_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_ROOT="$(cd "$CLI_ROOT/.." && pwd)"
cd "$CLI_ROOT"

load_env() {
  local f="$1"
  if [ -f "$f" ]; then
    set -a
    # shellcheck disable=SC1090
    source "$f"
    set +a
  fi
}

load_env "$REPO_ROOT/chain/.env"
load_env "$CLI_ROOT/.env"

export CHAIN_RPC_URL="${CHAIN_RPC_URL:-${BASE_SEPOLIA_RPC_URL:-https://sepolia.base.org}}"

if [ -z "${REGISTRY_ADDRESS:-}" ]; then
  echo "ERROR: Set REGISTRY_ADDRESS (in chain/.env, clanker-cli/.env, or the environment)." >&2
  exit 1
fi

if [ $# -lt 1 ]; then
  echo "Usage: $0 <mint-operator|mint-bot|...> [args...]" >&2
  exit 1
fi

SUB="$1"
shift
exec node ./bin/clanker.mjs chain "$SUB" "$@"

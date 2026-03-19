#!/usr/bin/env bash
set -euo pipefail

# Convenience wrapper so you can run the same gate before committing.
# Usage:
#   ./scripts/prepush-check.sh

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "[prepush-check] Running scripts/ci-local.sh"
bash "$ROOT_DIR/scripts/ci-local.sh"

echo "[prepush-check] OK"


#!/usr/bin/env bash
# Download and install clanker-chain-mqtt (MQTT plugin) from a GitHub release asset.
# Usage: GITHUB_TOKEN=ghp_xxx ./install-mqtt-extension.sh <ASSET_ID>
# Asset ID: from the release page, click the .tgz and use the ID from the URL.
set -euo pipefail

REPO_API="https://api.github.com/repos/pjsandwich/clanker-chain/releases/assets"
OPENCLAW_ROOT="${OPENCLAW_ROOT:-$HOME/services/openclaw}"
OPENCLAW_EXTENSIONS_DIR="${OPENCLAW_EXTENSIONS_DIR:-$OPENCLAW_ROOT/extensions}"

MQTT_ASSET_ID="${1:-${MQTT_ASSET_ID:-}}"
GITHUB_TOKEN="${GITHUB_TOKEN:-}"

if [ -z "$GITHUB_TOKEN" ]; then
  echo "ERROR: GITHUB_TOKEN is required (private release asset)." >&2
  exit 1
fi

if [ -z "$MQTT_ASSET_ID" ]; then
  echo "ERROR: MQTT_ASSET_ID required. Pass as first arg or set env. Get from release page (click .tgz, use ID from URL)." >&2
  exit 1
fi

if [ ! -d "$OPENCLAW_ROOT" ]; then
  echo "ERROR: OpenClaw repo not found at $OPENCLAW_ROOT" >&2
  exit 1
fi

WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT

echo "Downloading clanker-chain-mqtt asset $MQTT_ASSET_ID..."
curl -fsSL \
  -H "Authorization: Bearer ${GITHUB_TOKEN}" \
  -H "Accept: application/octet-stream" \
  "${REPO_API}/${MQTT_ASSET_ID}" \
  | tar -xzf - -C "$WORK_DIR"

PLUGIN_DIR="$WORK_DIR/mqtt-client-plugin"
if [ ! -f "$PLUGIN_DIR/install.sh" ]; then
  echo "ERROR: Expected mqtt-client-plugin/install.sh in tarball. Contents:" >&2
  ls -la "$WORK_DIR" >&2
  exit 1
fi

export OPENCLAW_EXTENSIONS_DIR OPENCLAW_ROOT
bash "$PLUGIN_DIR/install.sh"

echo "Clanker Chain MQTT plugin installed. Add clanker-chain-mqtt to OPENCLAW_EXTENSIONS in .env and to enabled plugins in openclaw.json, then rebuild."

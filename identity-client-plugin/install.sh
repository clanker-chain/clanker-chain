#!/usr/bin/env bash
set -euo pipefail

PLUGIN_NAME="identity-client-plugin"
TARGET_ROOT="${OPENCLAW_EXTENSIONS_DIR:-$HOME/.openclaw/extensions}"

echo "Installing $PLUGIN_NAME into: $TARGET_ROOT/$PLUGIN_NAME"

SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

mkdir -p "$TARGET_ROOT"
rm -rf "$TARGET_ROOT/$PLUGIN_NAME"
cp -R "$SRC_DIR" "$TARGET_ROOT/$PLUGIN_NAME"

if [ -f "$TARGET_ROOT/$PLUGIN_NAME/package.json" ]; then
  echo "Running npm install --production inside $TARGET_ROOT/$PLUGIN_NAME (if Node is available)..."
  (cd "$TARGET_ROOT/$PLUGIN_NAME" && npm install --production) || echo "npm install failed or Node not available; ensure dependencies are installed if required."
fi

echo "Done. Restart OpenClaw so it picks up the new plugin."
echo "Plugin path: $TARGET_ROOT/$PLUGIN_NAME"

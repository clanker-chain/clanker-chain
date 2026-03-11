#!/usr/bin/env bash
set -euo pipefail

PLUGIN_NAME="identity-client-plugin"
if [ -n "${OPENCLAW_EXTENSIONS_DIR:-}" ]; then
  TARGET_ROOT="$OPENCLAW_EXTENSIONS_DIR"
  # OpenClaw Docker: app loads from /app/extensions; /extensions would be wrong
  if [ "$TARGET_ROOT" = /extensions ] && [ -d /app/extensions ]; then
    TARGET_ROOT="/app/extensions"
  fi
elif [ -d /app/extensions ]; then
  TARGET_ROOT="/app/extensions"
else
  TARGET_ROOT="$HOME/.openclaw/extensions"
fi

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

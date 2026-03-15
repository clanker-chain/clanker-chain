#!/usr/bin/env bash
set -euo pipefail

PLUGIN_NAME="mqtt-client-plugin"
if [ -n "${OPENCLAW_EXTENSIONS_DIR:-}" ]; then
  TARGET_ROOT="$OPENCLAW_EXTENSIONS_DIR"
  if [ "$TARGET_ROOT" = /extensions ] && [ -d /app/extensions ]; then
    TARGET_ROOT="/app/extensions"
  fi
elif [ -d /app/extensions ]; then
  TARGET_ROOT="/app/extensions"
else
  TARGET_ROOT="${HOME}/.openclaw/extensions"
fi

echo "Installing $PLUGIN_NAME into: $TARGET_ROOT/$PLUGIN_NAME"

SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

mkdir -p "$TARGET_ROOT"
rm -rf "$TARGET_ROOT/$PLUGIN_NAME"
cp -R "$SRC_DIR" "$TARGET_ROOT/$PLUGIN_NAME"

# Unpack file: deps from tarball's node_modules so pnpm install in OpenClaw repo can resolve them
if [ -d "$TARGET_ROOT/$PLUGIN_NAME/node_modules/identity-node-client" ]; then
  rm -rf "$TARGET_ROOT/identity-node-client"
  cp -R "$TARGET_ROOT/$PLUGIN_NAME/node_modules/identity-node-client" "$TARGET_ROOT/"
  echo "Unpacked identity-node-client for workspace resolution"
fi
if [ -d "$TARGET_ROOT/$PLUGIN_NAME/node_modules/mqtt-node-client" ]; then
  rm -rf "$TARGET_ROOT/mqtt-node-client"
  cp -R "$TARGET_ROOT/$PLUGIN_NAME/node_modules/mqtt-node-client" "$TARGET_ROOT/"
  echo "Unpacked mqtt-node-client for workspace resolution"
fi

# Expose the plugin's skill (same pattern as identity)
SKILLS_DIR="${OPENCLAW_SKILLS_DIR:-}"
if [ -z "$SKILLS_DIR" ] && [ -d /app/skills ]; then
  SKILLS_DIR="/app/skills"
fi
if [ -n "$SKILLS_DIR" ] && [ -d "$TARGET_ROOT/$PLUGIN_NAME/src/skill" ]; then
  rm -rf "$SKILLS_DIR/mqtt"
  ln -sf "$TARGET_ROOT/$PLUGIN_NAME/src/skill" "$SKILLS_DIR/mqtt"
  echo "Skill symlink: $SKILLS_DIR/mqtt -> $TARGET_ROOT/$PLUGIN_NAME/src/skill"
fi

# Update OpenClaw workspace lockfile so "docker compose build" with OPENCLAW_EXTENSIONS succeeds
OPENCLAW_ROOT="${OPENCLAW_ROOT:-$(dirname "$TARGET_ROOT")}"
if [ -f "$OPENCLAW_ROOT/pnpm-workspace.yaml" ]; then
  echo "Running pnpm install in OpenClaw repo ($OPENCLAW_ROOT) to update lockfile..."
  (cd "$OPENCLAW_ROOT" && npx --yes pnpm install) || echo "pnpm install skipped (npx/pnpm not available)."
fi

echo "Done. Restart OpenClaw so it picks up the new plugin."
echo "Plugin path: $TARGET_ROOT/$PLUGIN_NAME"

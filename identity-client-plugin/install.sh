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

# Expose the plugin's skill as skills/identity so OpenClaw has both the tooling (plugin) and the
# reference instruction set (SKILL.md in skills/identity), same pattern as Slack.
SKILLS_DIR="${OPENCLAW_SKILLS_DIR:-}"
if [ -z "$SKILLS_DIR" ] && [ -d /app/skills ]; then
  SKILLS_DIR="/app/skills"
fi
if [ -n "$SKILLS_DIR" ] && [ -d "$TARGET_ROOT/$PLUGIN_NAME/skill" ]; then
  rm -rf "$SKILLS_DIR/identity"
  ln -sf "$TARGET_ROOT/$PLUGIN_NAME/skill" "$SKILLS_DIR/identity"
  echo "Skill symlink: $SKILLS_DIR/identity -> $TARGET_ROOT/$PLUGIN_NAME/skill"
fi

echo "Done. Restart OpenClaw so it picks up the new plugin."
echo "Plugin path: $TARGET_ROOT/$PLUGIN_NAME"

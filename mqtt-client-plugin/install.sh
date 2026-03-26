#!/usr/bin/env bash
set -euo pipefail

PLUGIN_NAME="${PLUGIN_NAME:-clanker-chain-mqtt}"
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

# Unpack local node-client deps from tarball so pnpm workspace resolution works in OpenClaw repos.
unpack_local_dep() {
  # Args: $1 package dir name
  local dep_name="$1"
  local dep_root="$TARGET_ROOT/$PLUGIN_NAME/node_modules/$dep_name"
  local src=""

  if [ -d "$dep_root/$dep_name" ]; then
    # Handle nested layouts like node_modules/<name>/<name>.
    src="$dep_root/$dep_name"
  elif [ -d "$dep_root" ]; then
    # Handle standard layout: node_modules/<name>.
    src="$dep_root"
  fi

  if [ -n "$src" ]; then
    rm -rf "$TARGET_ROOT/$dep_name"
    cp -R "$src" "$TARGET_ROOT/$dep_name"
    echo "Unpacked $dep_name for workspace resolution"
  fi
}

unpack_local_dep "identity-node-client"
unpack_local_dep "mqtt-node-client"

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
  (cd "$OPENCLAW_ROOT" && npx --yes pnpm install --ignore-scripts) || echo "pnpm install skipped (npx/pnpm not available)."
fi

echo "Done. Restart OpenClaw so it picks up the new plugin."
echo "Plugin path: $TARGET_ROOT/$PLUGIN_NAME"

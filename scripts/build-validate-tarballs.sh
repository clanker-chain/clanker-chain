#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK_DIR="${WORK_DIR:-}"
if [ -z "$WORK_DIR" ]; then
  WORK_DIR="$(mktemp -d)"
fi

cleanup() {
  if [ -n "${WORK_DIR:-}" ] && [ -d "$WORK_DIR" ]; then
    rm -rf "$WORK_DIR"
  fi
}
trap cleanup EXIT

log() {
  echo "[build-validate-tarballs] $*" >&2
}

validate_tarball() {
  local tarball_path="$1"
  local expected_root="$2"

  log "Validating tarball: $(basename "$tarball_path")"

  local extract_dir="$WORK_DIR/extract/$(basename "$tarball_path" .tgz)"
  mkdir -p "$extract_dir"
  tar -xzf "$tarball_path" -C "$extract_dir"

  local plugin_root_dir="${extract_dir}/${expected_root}"
  if [ ! -d "$plugin_root_dir" ]; then
    echo "ERROR: Expected plugin root dir '$expected_root' not found in tarball." >&2
    exit 1
  fi

  python3 - "$plugin_root_dir" <<'PY'
import json
import os
import sys

plugin_root = sys.argv[1]
pkg_path = os.path.join(plugin_root, "package.json")

with open(pkg_path, "r", encoding="utf-8") as f:
  pkg = json.load(f)

openclaw = pkg.get("openclaw") or {}
extensions = openclaw.get("extensions") or []
if not extensions:
  print(f"ERROR: No openclaw.extensions found in {os.path.basename(plugin_root)}/package.json", file=sys.stderr)
  sys.exit(1)

missing = []
for ext in extensions:
  resolved = os.path.join(plugin_root, ext)
  if not os.path.exists(resolved):
    missing.append((ext, resolved))

setup_entry = openclaw.get("setupEntry")
if setup_entry:
  resolved = os.path.join(plugin_root, setup_entry)
  if not os.path.exists(resolved):
    missing.append((setup_entry, resolved))

if missing:
  print("ERROR: Tarball validation failed. Missing openclaw extension/setupEntry files:", file=sys.stderr)
  for ext, resolved in missing:
    print(f"- {ext} (expected at {resolved})", file=sys.stderr)
  sys.exit(1)
PY

  log "Tarball OK: $(basename "$tarball_path")"
}

build_mqtt_channel_plugin() {
  log "Building mqtt-channel-plugin tarball (bundle)"
  local tarball_path="${WORK_DIR}/mqtt-channel-plugin.tgz"

  (cd "${ROOT_DIR}/packages/identity-node-client" && npm ci 1>&2 && npm run build 1>&2)
  (cd "${ROOT_DIR}/packages/mqtt-node-client" && npm ci 1>&2 && npm run build 1>&2)

  local plugin_dir="${ROOT_DIR}/openclaw/mqtt-channel-plugin"
  mkdir -p "${plugin_dir}/node_modules/@clanker-chain"
  ln -sfn "${ROOT_DIR}/packages/identity-node-client" "${plugin_dir}/node_modules/@clanker-chain/identity-node-client"
  ln -sfn "${ROOT_DIR}/packages/mqtt-node-client" "${plugin_dir}/node_modules/@clanker-chain/mqtt-node-client"
  (cd "$plugin_dir" && npm install 1>&2 && npm run build 1>&2)

  local bundle_dir="${WORK_DIR}/bundle/mqtt-channel-plugin"
  rm -rf "$bundle_dir"
  mkdir -p "$bundle_dir"

  cp "${plugin_dir}/package.json" \
    "${plugin_dir}/openclaw.plugin.json" \
    "${plugin_dir}/README.md" \
    "$bundle_dir/"
  cp -R "${plugin_dir}/dist" "$bundle_dir/"
  mkdir -p "$bundle_dir/node_modules/@clanker-chain"
  cp -RL "${ROOT_DIR}/packages/identity-node-client" "$bundle_dir/node_modules/@clanker-chain/identity-node-client"
  cp -RL "${ROOT_DIR}/packages/mqtt-node-client" "$bundle_dir/node_modules/@clanker-chain/mqtt-node-client"

  tar -czf "$tarball_path" -C "${WORK_DIR}/bundle" "mqtt-channel-plugin"

  echo "$tarball_path"
}

build_mqtt_tools_plugin() {
  log "Building mqtt-tools-plugin tarball (bundle)"
  local tarball_path="${WORK_DIR}/mqtt-tools-plugin.tgz"

  (cd "${ROOT_DIR}/packages/identity-node-client" && npm ci 1>&2 && npm run build 1>&2)
  (cd "${ROOT_DIR}/packages/mqtt-node-client" && npm ci 1>&2 && npm run build 1>&2)

  local plugin_dir="${ROOT_DIR}/openclaw/mqtt-tools-plugin"
  mkdir -p "${plugin_dir}/node_modules/@clanker-chain"
  ln -sfn "${ROOT_DIR}/packages/identity-node-client" "${plugin_dir}/node_modules/@clanker-chain/identity-node-client"
  ln -sfn "${ROOT_DIR}/packages/mqtt-node-client" "${plugin_dir}/node_modules/@clanker-chain/mqtt-node-client"
  (cd "$plugin_dir" && npm install 1>&2 && npm run build 1>&2)

  local bundle_dir="${WORK_DIR}/bundle/mqtt-tools-plugin"
  rm -rf "$bundle_dir"
  mkdir -p "$bundle_dir"

  cp "${plugin_dir}/package.json" \
    "${plugin_dir}/openclaw.plugin.json" \
    "${plugin_dir}/README.md" \
    "$bundle_dir/"
  cp -R "${plugin_dir}/dist" "$bundle_dir/"
  mkdir -p "$bundle_dir/node_modules/@clanker-chain"
  cp -RL "${ROOT_DIR}/packages/identity-node-client" "$bundle_dir/node_modules/@clanker-chain/identity-node-client"
  cp -RL "${ROOT_DIR}/packages/mqtt-node-client" "$bundle_dir/node_modules/@clanker-chain/mqtt-node-client"

  tar -czf "$tarball_path" -C "${WORK_DIR}/bundle" "mqtt-tools-plugin"

  echo "$tarball_path"
}

main() {
  log "Building + validating shipped OpenClaw plugin tarballs (channel + tools)"

  local mqtt_channel_tgz mqtt_tools_tgz
  mqtt_channel_tgz="$(build_mqtt_channel_plugin)"
  mqtt_tools_tgz="$(build_mqtt_tools_plugin)"

  validate_tarball "$mqtt_channel_tgz" "mqtt-channel-plugin"
  validate_tarball "$mqtt_tools_tgz" "mqtt-tools-plugin"

  log "All tarball validations passed"
}

main "$@"

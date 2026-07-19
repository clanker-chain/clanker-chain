#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

SKIP_TARBALL_VALIDATION="${SKIP_TARBALL_VALIDATION:-0}"
CI_MODE="${CI_MODE:-0}"

while [ $# -gt 0 ]; do
  case "$1" in
    --skip-tarballs)
      SKIP_TARBALL_VALIDATION=1
      shift
      ;;
    --ci)
      CI_MODE=1
      shift
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

log() {
  echo "[ci-local] $*"
}

have_cmd() {
  command -v "$1" >/dev/null 2>&1
}

log "Tooling sanity checks"
if ! have_cmd bun; then
  echo "ERROR: bun is required (install Bun or run with CI toolchains)." >&2
  exit 1
fi
if ! have_cmd npm; then
  echo "ERROR: npm is required." >&2
  exit 1
fi

run_bun_package() {
  # Args: $1 dir
  local dir="$1"
  log "Bun package checks: $dir"

  # Bun lockfiles: bun.lock (text) is the newer format; bun.lockb is legacy.
  local has_bun_lock=0
  if [ -f "${dir}/bun.lock" ] || [ -f "${dir}/bun.lockb" ]; then
    has_bun_lock=1
  fi

  if [ "$CI_MODE" = "1" ]; then
    if [ "$has_bun_lock" -eq 1 ]; then
      (cd "$dir" && bun install --frozen-lockfile)
    else
      echo "ERROR: --ci requires a bun lockfile (bun.lock or bun.lockb) in ${dir} for reproducible installs." >&2
      exit 1
    fi
  else
    (cd "$dir" && bun install)
  fi

  if [ -f "${dir}/package.json" ]; then
    # Fast, hermetic unit lane: prefer `test:unit` (chain-backed suites skipped
    # via EVM_TESTS_SKIP) so a contract change can't red-fail unit tests. The
    # anvil-backed integration lane runs later (see run_bun_integration).
    if node -e "const p=require('${dir}/package.json'); process.exit(p.scripts && p.scripts['test:unit'] ? 0 : 1);" ; then
      (cd "$dir" && bun run test:unit)
    elif node -e "const p=require('${dir}/package.json'); process.exit(p.scripts && p.scripts.test ? 0 : 1);" ; then
      (cd "$dir" && bun run test)
    else
      log "No bun test script in ${dir} (skipping tests)."
    fi
  fi

  if [ -f "${dir}/tsconfig.json" ]; then
    # bun check isn't guaranteed; use tsc via bun.
    (cd "$dir" && bun x tsc -p tsconfig.json)
  else
    log "No tsconfig.json in ${dir} (skipping typecheck)."
  fi
}

run_bun_integration() {
  # Args: $1 dir. Runs the anvil-backed integration suite (requires Foundry).
  local dir="$1"
  [ -f "${dir}/package.json" ] || return 0
  if node -e "const p=require('${dir}/package.json'); process.exit(p.scripts && p.scripts['test:integration'] ? 0 : 1);" ; then
    log "Integration tests (anvil-backed): ${dir}"
    (cd "$dir" && bun run test:integration)
  fi
}

run_foundry_chain() {
  if [ -d "${HOME}/.foundry/bin" ]; then
    PATH="${HOME}/.foundry/bin:${PATH}"
    export PATH
  fi

  if ! have_cmd forge; then
    if [ "$CI_MODE" = "1" ]; then
      echo "ERROR: forge is required in --ci mode (Foundry toolchain)." >&2
      exit 1
    fi
    log "forge not on PATH — skipping chain/ Solidity tests. Install Foundry: https://book.getfoundry.sh/getting-started/installation"
    return 0
  fi

  if [ ! -d "${ROOT_DIR}/chain" ]; then
    log "No chain/ directory (skipping Foundry tests)."
    return 0
  fi

  log "Foundry tests: chain/"
  (cd "${ROOT_DIR}/chain" && forge test -vvv)
}

run_npm_package() {
  # Args: $1 dir
  local dir="$1"
  log "NPM package checks: $dir"

  if [ "$CI_MODE" = "1" ]; then
    if [ ! -f "${dir}/package-lock.json" ]; then
      echo "ERROR: --ci requires ${dir}/package-lock.json for npm ci." >&2
      exit 1
    fi
    (cd "$dir" && npm ci)
  else
    if [ -f "${dir}/package-lock.json" ]; then
      (cd "$dir" && npm ci)
    else
      (cd "$dir" && npm install)
    fi
  fi

  if [ -f "${dir}/package.json" ]; then
    if node -e "const p=require('${dir}/package.json'); process.exit(p.scripts && p.scripts.build ? 0 : 1);" ; then
      if [ -f "${dir}/tsconfig.json" ]; then
        (cd "$dir" && npm run build)
      else
        log "Skipping npm run build in ${dir} (no tsconfig.json; build script likely not applicable)."
      fi
    fi
    if node -e "const p=require('${dir}/package.json'); process.exit(p.scripts && p.scripts.test ? 0 : 1);" ; then
      (cd "$dir" && npm run test)
    fi
  fi
}

main() {
  log "Running local CI checks"

  # Bun packages (identity service + mqtt auth service)
  run_bun_package "${ROOT_DIR}/identity-service"
  run_bun_package "${ROOT_DIR}/mqtt-auth-service"

  # NPM/TS packages
  run_npm_package "${ROOT_DIR}/identity-client-plugin"
  run_npm_package "${ROOT_DIR}/mqtt-node-client"
  run_npm_package "${ROOT_DIR}/identity-node-client"

  # mqtt-channel-plugin uses workspace:* dependencies and doesn't ship a lockfile,
  # so we avoid npm install here. Instead, we symlink the local node clients and
  # run TypeScript against that compile graph.
  log "TS check/build for mqtt-channel-plugin (OpenClaw channel SDK plugin)"
  mkdir -p "${ROOT_DIR}/openclaw-extensions/mqtt-channel-plugin/node_modules/@clanker-chain"
  ln -sfn "${ROOT_DIR}/identity-node-client" "${ROOT_DIR}/openclaw-extensions/mqtt-channel-plugin/node_modules/@clanker-chain/identity-node-client"
  ln -sfn "${ROOT_DIR}/mqtt-node-client" "${ROOT_DIR}/openclaw-extensions/mqtt-channel-plugin/node_modules/@clanker-chain/mqtt-node-client"
  (cd "${ROOT_DIR}/openclaw-extensions/mqtt-channel-plugin" && bun x tsc -p tsconfig.json)
  (cd "${ROOT_DIR}/openclaw-extensions/mqtt-channel-plugin" && bun test test/)

  log "TS check/build for mqtt-tools-plugin (OpenClaw tool plugin)"
  MQTT_TOOLS_DIR="${ROOT_DIR}/openclaw-extensions/mqtt-tools-plugin"
  mkdir -p "${MQTT_TOOLS_DIR}/node_modules/@clanker-chain"
  ln -sfn "${ROOT_DIR}/identity-node-client" "${MQTT_TOOLS_DIR}/node_modules/@clanker-chain/identity-node-client"
  ln -sfn "${ROOT_DIR}/mqtt-node-client" "${MQTT_TOOLS_DIR}/node_modules/@clanker-chain/mqtt-node-client"
  # typebox is a runtime dep; do not run `npm install` in this package — it would fetch
  # @clanker-chain/mqtt-node-client@2026.5.25 from npm before that CalVer is published.
  if [ ! -d "${MQTT_TOOLS_DIR}/node_modules/typebox" ]; then
    MQTT_TOOLS_TYPEBOX_TMP="$(mktemp -d)"
    (cd "${MQTT_TOOLS_TYPEBOX_TMP}" && npm pack typebox@1.1.38 --silent && tar -xzf typebox-*.tgz)
    mv "${MQTT_TOOLS_TYPEBOX_TMP}/package" "${MQTT_TOOLS_DIR}/node_modules/typebox"
    rm -rf "${MQTT_TOOLS_TYPEBOX_TMP}"
  fi
  (cd "${MQTT_TOOLS_DIR}" && bun x tsc -p tsconfig.json)
  (cd "${MQTT_TOOLS_DIR}" && bun test test/)

  # mqtt-client-plugin depends on @clanker-chain/mqtt-node-client and
  # @clanker-chain/identity-node-client which are local packages (not yet on npm
  # at dev time). Symlink them instead of running npm ci.
  log "Linking mqtt-client-plugin deps from local sources"
  mkdir -p "${ROOT_DIR}/mqtt-client-plugin/node_modules/@clanker-chain"
  ln -sfn "${ROOT_DIR}/identity-node-client" "${ROOT_DIR}/mqtt-client-plugin/node_modules/@clanker-chain/identity-node-client"
  ln -sfn "${ROOT_DIR}/mqtt-node-client" "${ROOT_DIR}/mqtt-client-plugin/node_modules/@clanker-chain/mqtt-node-client"

  if [ -f "${ROOT_DIR}/mqtt-client-plugin/tsconfig.json" ]; then
    (cd "${ROOT_DIR}/mqtt-client-plugin" && bun x tsc -p tsconfig.json)
  else
    log "No mqtt-client-plugin/tsconfig.json (skipping TS check for mqtt-client-plugin)."
  fi

  run_foundry_chain

  # ABI drift guard: the committed TS/JS ABIs must match the compiled contract.
  # run_foundry_chain builds artifacts (and guarantees forge in --ci mode).
  if have_cmd forge; then
    log "ABI drift check (generated vs committed)"
    node "${ROOT_DIR}/scripts/gen-abi.mjs" --check
  elif [ "$CI_MODE" = "1" ]; then
    echo "ERROR: --ci requires forge for the ABI drift check." >&2
    exit 1
  else
    log "forge not on PATH — skipping ABI drift check."
  fi

  # Anvil-backed integration lane (separate from the fast unit lane above).
  if have_cmd forge && have_cmd anvil; then
    log "Running anvil-backed integration suites"
    run_bun_integration "${ROOT_DIR}/identity-service"
    run_bun_integration "${ROOT_DIR}/mqtt-auth-service"
  elif [ "$CI_MODE" = "1" ]; then
    echo "ERROR: --ci requires Foundry (anvil + forge) for integration tests." >&2
    exit 1
  else
    log "Foundry not on PATH — skipping anvil-backed integration suites."
  fi

  if [ "$SKIP_TARBALL_VALIDATION" = "1" ]; then
    log "Skipping tarball validation as requested."
  else
    log "Building + validating release-style tarballs"
    (cd "$ROOT_DIR" && bash ./scripts/build-validate-tarballs.sh)
  fi

  log "CI local checks passed"
}

main "$@"


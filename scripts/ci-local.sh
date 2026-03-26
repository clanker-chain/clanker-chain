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
    # Run tests only if a test script exists.
    if node -e "const p=require('${dir}/package.json'); process.exit(p.scripts && p.scripts.test ? 0 : 1);" ; then
      local server_pid=""
      # Some tests expect local services to be running (e.g. identity-service).
      if [ "$(basename "$dir")" = "identity-service" ]; then
        # Always start a fresh identity-service instance on a free port.
        identity_port=""
        for candidate in 8080 8081 8082 8083 8084 8085 8086 8087 8088 8089 8090; do
          if bun -e "fetch('http://localhost:${candidate}/v1/operators', { method: 'GET' }).then(() => process.exit(0)).catch(() => process.exit(1))" >/dev/null 2>&1; then
            continue
          else
            identity_port="$candidate"
            break
          fi
        done

        if [ -z "$identity_port" ]; then
          echo "ERROR: Could not find a free port for identity-service tests." >&2
          exit 1
        fi

        export IDENTITY_SERVICE_PORT="$identity_port"
        export IDENTITY_SERVICE_URL="http://localhost:${identity_port}"

        log "Starting identity-service server for tests on ${IDENTITY_SERVICE_URL}"
        (cd "$dir" && bun run src/server.ts) &
        server_pid="$!"

        # Wait for the server to accept connections.
        for _ in $(seq 1 80); do
          if bun -e "fetch('${IDENTITY_SERVICE_URL}/v1/operators', { method: 'GET' }).then(() => process.exit(0)).catch(() => process.exit(1))" >/dev/null 2>&1; then
            break
          fi
          sleep 0.25
        done
      fi

      (cd "$dir" && bun run test)

      if [ -n "$server_pid" ]; then
        kill "$server_pid" >/dev/null 2>&1 || true
      fi
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
  log "TS check/build for mqtt-channel-plugin"
  mkdir -p "${ROOT_DIR}/openclaw-extensions/mqtt-channel-plugin/node_modules"
  ln -sf "${ROOT_DIR}/identity-node-client" "${ROOT_DIR}/openclaw-extensions/mqtt-channel-plugin/node_modules/identity-node-client"
  ln -sf "${ROOT_DIR}/mqtt-node-client" "${ROOT_DIR}/openclaw-extensions/mqtt-channel-plugin/node_modules/mqtt-node-client"
  (cd "${ROOT_DIR}/openclaw-extensions/mqtt-channel-plugin" && bun x tsc -p tsconfig.json)

  # Bundle/runtime packages (install only; bundle validation checks correctness)
  run_npm_package "${ROOT_DIR}/mqtt-client-plugin"

  if [ "$SKIP_TARBALL_VALIDATION" = "1" ]; then
    log "Skipping tarball validation as requested."
  else
    log "Building + validating release-style tarballs"
    (cd "$ROOT_DIR" && bash ./scripts/build-validate-tarballs.sh)
  fi

  log "CI local checks passed"
}

main "$@"


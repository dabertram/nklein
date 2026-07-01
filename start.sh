#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

FORCE=0
TEST=0
for arg in "$@"; do
  case "$arg" in
    --force | -f) FORCE=1 ;;
    --test | -t) TEST=1 ;;
    --help | -h)
      echo "Usage: ./start.sh [--force] [--test]"
      echo "  Starts !Klein in full dev mode (runtime :3484 + Vite UI :4173). Detects a"
      echo "  leftover dev instance from a previous run and offers to shut it down first"
      echo "  (a stale instance does not hot-reload, so it silently serves old code)."
      echo "  --force, -f   Shut down any stale instance without asking."
      echo "  --test,  -t   Spawn an ISOLATED TEST instance ALONGSIDE your main one:"
      echo "                offset ports (runtime :3584 + UI :4273) + a separate data dir"
      echo "                (.nklein-test-home/.nklein) — never touches your real board and"
      echo "                never kills the main instance. Then open http://127.0.0.1:4273."
      exit 0
      ;;
  esac
done

# Default dev ports (scripts/dev-full.mjs: tsx src/cli.ts runtime + Vite UI).
RUNTIME_PORT=3484
WEB_UI_PORT=4173

# Collect PIDs of a leftover !Klein dev stack: the processes *listening* on the dev ports (LISTEN only — never a
# browser tab merely connected to the UI) plus this repo's dev orchestrator. Always exits 0 (empty = none).
collect_stale_pids() {
  {
    lsof -ti "tcp:${RUNTIME_PORT}" -sTCP:LISTEN 2>/dev/null || true
    lsof -ti "tcp:${WEB_UI_PORT}" -sTCP:LISTEN 2>/dev/null || true
    pgrep -f "${ROOT_DIR}/scripts/dev-full.mjs" 2>/dev/null || true
    pgrep -f "${ROOT_DIR}/.*tsx.* src/cli.ts" 2>/dev/null || true
  } | grep -E '^[0-9]+$' | sort -u || true
}

stop_stale_instance() {
  local pids="$1"
  echo "Stopping stale instance(s)..."
  # Graceful SIGTERM first so the runtime can clean up sandboxes, then SIGKILL any survivors.
  for pid in ${pids}; do kill "${pid}" 2>/dev/null || true; done
  for _ in 1 2 3 4 5; do
    sleep 1
    [[ -z "$(collect_stale_pids)" ]] && break
  done
  local remaining
  remaining="$(collect_stale_pids)"
  if [[ -n "${remaining}" ]]; then
    for pid in ${remaining}; do kill -9 "${pid}" 2>/dev/null || true; done
    sleep 1
  fi
  if [[ -n "$(collect_stale_pids)" ]]; then
    echo "Could not stop every stale process; aborting so we don't run two instances." >&2
    exit 1
  fi
  echo "Stale instance(s) stopped."
}

# A --test instance runs on offset ports + an isolated data dir, so it MUST NOT touch the main instance — skip the
# stale-detection/kill entirely in test mode (leave STALE_PIDS empty so the block below is a no-op).
STALE_PIDS=""
if [[ "${TEST}" -eq 0 ]]; then
  STALE_PIDS="$(collect_stale_pids)"
fi
if [[ -n "${STALE_PIDS}" ]]; then
  echo "Detected a running !Klein dev instance (ports ${RUNTIME_PORT}/${WEB_UI_PORT} or dev-full.mjs):"
  for pid in ${STALE_PIDS}; do
    ps -p "${pid}" -o pid=,command= 2>/dev/null | sed 's/^/  /' | cut -c1-118 || true
  done
  if [[ "${FORCE}" -eq 1 ]]; then
    stop_stale_instance "${STALE_PIDS}"
  else
    printf "Shut it down and start fresh? [y/N] "
    REPLY=""
    read -r REPLY < /dev/tty 2>/dev/null || REPLY=""
    case "${REPLY}" in
      y | Y | yes | YES) stop_stale_instance "${STALE_PIDS}" ;;
      *)
        echo "Left the existing instance running. Aborting (it would bind the same ports)." >&2
        echo "Re-run with --force to shut it down automatically." >&2
        exit 1
        ;;
    esac
  fi
fi

if [[ ! -d node_modules || ! -d web-ui/node_modules || ! -d packages/desktop/node_modules ]]; then
  echo "Installing dependencies (root, web-ui, desktop)..."
  npm run install:all
fi

if [[ "${TEST}" -eq 1 ]]; then
  # Isolated test instance: its own HOME (⇒ its own ~/.nklein data), offset base ports, and NKLEIN_DEV_ISOLATED so
  # dev-full.mjs skips the reach/kill/wait-for-preferred-ports logic. Deps were already ensured above under the real HOME.
  TEST_HOME="${ROOT_DIR}/.nklein-test-home"
  mkdir -p "${TEST_HOME}"
  echo "Starting !Klein ISOLATED TEST instance..."
  echo "  data dir: ${TEST_HOME}/.nklein   ports: runtime 3584 / UI 4273"
  echo "  (separate from your main board; coexists with a running main instance) — open http://127.0.0.1:4273"
  exec env HOME="${TEST_HOME}" \
    NKLEIN_DEV_ISOLATED=1 \
    NKLEIN_DEV_RUNTIME_PORT=3584 \
    NKLEIN_DEV_WEB_UI_PORT=4273 \
    npm run dev:full
fi

echo "Starting !Klein in full dev mode..."
exec npm run dev:full

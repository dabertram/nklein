#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

FORCE=0
for arg in "$@"; do
  case "$arg" in
    --force | -f) FORCE=1 ;;
    --help | -h)
      echo "Usage: ./start.sh [--force]"
      echo "  Starts !Klein in full dev mode. Detects a leftover dev instance from a"
      echo "  previous run and offers to shut it down first (a stale instance does not"
      echo "  hot-reload, so it silently serves old code)."
      echo "  --force, -f   Shut down any stale instance without asking."
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

STALE_PIDS="$(collect_stale_pids)"
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

echo "Starting !Klein in full dev mode..."
exec npm run dev:full

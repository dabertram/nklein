#!/usr/bin/env bash
# Thin wrapper — all launch logic (arg parsing, env preflight, stale-instance detection, start) lives in the single
# cross-platform Node launcher start.mjs (node:util.parseArgs). This script only ensures Node is present, then hands off.
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 22 or newer is required to run !Klein." >&2
  echo "Install it from https://nodejs.org/ (or via your package manager), then run ./start.sh again." >&2
  exit 1
fi

exec node "${ROOT_DIR}/start.mjs" "$@"

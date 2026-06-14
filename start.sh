#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

if [[ ! -d node_modules || ! -d web-ui/node_modules || ! -d packages/desktop/node_modules ]]; then
  echo "Installing dependencies (root, web-ui, desktop)..."
  npm run install:all
fi

echo "Starting Kanban in full dev mode..."
exec npm run dev:full

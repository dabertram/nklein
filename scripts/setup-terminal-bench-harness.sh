#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
REPO_DIR=$(dirname "$SCRIPT_DIR")
VENV_DIR="$REPO_DIR/benchmark-harness/harbor/.venv"
HARBOR_VERSION=0.5.0

if ! command -v uv >/dev/null 2>&1; then
	printf '%s\n' 'uv is required to provision the isolated Harbor environment.' >&2
	exit 1
fi

mkdir -p "$(dirname "$VENV_DIR")"
if [ ! -x "$VENV_DIR/bin/python" ]; then
	uv venv --python 3.12 "$VENV_DIR"
fi
uv pip install --python "$VENV_DIR/bin/python" "harbor==$HARBOR_VERSION"
PYTHONDONTWRITEBYTECODE=1 "$VENV_DIR/bin/python" "$REPO_DIR/scripts/verify-terminal-bench-adapter.py" --repo "$REPO_DIR"

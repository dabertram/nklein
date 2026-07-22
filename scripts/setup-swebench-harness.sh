#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
REPO_DIR=$(dirname "$SCRIPT_DIR")

if ! command -v uv >/dev/null 2>&1; then
	printf '%s\n' 'uv is required to provision the isolated benchmark environment.' >&2
	exit 1
fi

uv sync --project "$REPO_DIR/benchmark-harness" --locked
"$REPO_DIR/benchmark-harness/.venv/bin/python" "$REPO_DIR/scripts/verify-swebench-grader.py"

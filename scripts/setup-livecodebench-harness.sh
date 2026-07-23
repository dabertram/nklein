#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
REPO_DIR=$(dirname "$SCRIPT_DIR")
HARNESS_DIR="$REPO_DIR/benchmark-harness/livecodebench"
HARNESS_REPOSITORY=https://github.com/LiveCodeBench/LiveCodeBench.git
HARNESS_COMMIT=28fef95ea8c9f7a547c8329f2cd3d32b92c1fa24

if ! command -v uv >/dev/null 2>&1; then
	printf '%s\n' 'uv is required to provision the isolated LiveCodeBench environment.' >&2
	exit 1
fi
if [ -e "$HARNESS_DIR" ] && [ ! -d "$HARNESS_DIR/.git" ]; then
	printf '%s\n' "Refusing to replace non-Git LiveCodeBench harness path: $HARNESS_DIR" >&2
	exit 1
fi
if [ ! -d "$HARNESS_DIR/.git" ]; then
	git clone --filter=blob:none --no-checkout "$HARNESS_REPOSITORY" "$HARNESS_DIR"
fi
origin=$(git -C "$HARNESS_DIR" remote get-url origin)
if [ "$origin" != "$HARNESS_REPOSITORY" ]; then
	printf '%s\n' "Unexpected LiveCodeBench harness origin: $origin" >&2
	exit 1
fi
if [ -n "$(git -C "$HARNESS_DIR" status --porcelain)" ]; then
	printf '%s\n' 'LiveCodeBench harness checkout is dirty; refusing to overwrite it.' >&2
	exit 1
fi
git -C "$HARNESS_DIR" fetch --depth 1 origin "$HARNESS_COMMIT"
git -C "$HARNESS_DIR" checkout --detach "$HARNESS_COMMIT"
uv sync --project "$HARNESS_DIR" --locked
"$HARNESS_DIR/.venv/bin/python" -c 'from lcb_runner.runner.custom_evaluator import main; assert callable(main)'

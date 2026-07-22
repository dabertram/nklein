#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
REPO_DIR=$(dirname "$SCRIPT_DIR")
LIVE_HARNESS_DIR="$REPO_DIR/benchmark-harness/swebench-live"
LIVE_HARNESS_REPOSITORY=https://github.com/microsoft/SWE-bench-Live.git
LIVE_HARNESS_COMMIT=70ec57e852e3f2d195790fe71f553e272c691833

if ! command -v uv >/dev/null 2>&1; then
	printf '%s\n' 'uv is required to provision the isolated benchmark environment.' >&2
	exit 1
fi

uv sync --project "$REPO_DIR/benchmark-harness" --locked
"$REPO_DIR/benchmark-harness/.venv/bin/python" "$REPO_DIR/scripts/verify-swebench-grader.py"

if [ -e "$LIVE_HARNESS_DIR" ] && [ ! -d "$LIVE_HARNESS_DIR/.git" ]; then
	printf '%s\n' "Refusing to replace non-Git SWE-bench-Live harness path: $LIVE_HARNESS_DIR" >&2
	exit 1
fi
if [ ! -d "$LIVE_HARNESS_DIR/.git" ]; then
	git clone --filter=blob:none --no-checkout "$LIVE_HARNESS_REPOSITORY" "$LIVE_HARNESS_DIR"
fi
origin=$(git -C "$LIVE_HARNESS_DIR" remote get-url origin)
if [ "$origin" != "$LIVE_HARNESS_REPOSITORY" ]; then
	printf '%s\n' "Unexpected SWE-bench-Live harness origin: $origin" >&2
	exit 1
fi
git -C "$LIVE_HARNESS_DIR" fetch --depth 1 origin "$LIVE_HARNESS_COMMIT"
git -C "$LIVE_HARNESS_DIR" checkout --detach "$LIVE_HARNESS_COMMIT"
git -C "$LIVE_HARNESS_DIR" submodule sync --recursive
git -C "$LIVE_HARNESS_DIR" submodule update --init --depth 1 launch
"$REPO_DIR/benchmark-harness/.venv/bin/python" "$REPO_DIR/scripts/verify-swebench-live-grader.py" "$LIVE_HARNESS_DIR"

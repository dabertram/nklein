#!/bin/zsh
# SWE-bench campaign — create one measurement ARM: an isolated runtime (own HOME, own port, roles pinned to ONE model,
# a worktree snapshot of !Klein at an exact commit) plus the launchers the tranche runner needs.
#
#   scripts/swebench-arm-setup.sh <arm> <modelId> <port> <commit> [--image <sandbox image>] [--run-flags "<runner flags>"]
#
# Example (arm A of the 2026-09-14 campaign):
#   scripts/swebench-arm-setup.sh qwen36-27b-8bit "qwen/qwen3.6-27b" 3509 83c39fe71
# Then: <arm dir>/runtime.sh (background) → verify /health → <arm dir>/run.sh all 7200000
#
# The arm directory: $NKLEIN_DRAINS_ROOT/swebench-<arm>/{src,home,workspaces,results,logs,runtime.sh,run.sh}.
# Never loads or unloads models (operator does loads); the runner refuses to start when the model is not loaded.
set -euo pipefail
ARM="${1:?arm name}"; MODEL="${2:?modelId}"; PORT="${3:?port}"; COMMIT="${4:?nklein commit}"; shift 4
IMAGE=""; RUN_FLAGS="--no-plan"
while [[ $# -gt 0 ]]; do
	case "$1" in
		--image) IMAGE="$2"; shift 2 ;;
		--run-flags) RUN_FLAGS="$2"; shift 2 ;;
		*) echo "unknown option $1" >&2; exit 2 ;;
	esac
done
REPO="${NKLEIN_REPO:-/Users/david/GIT/nklein}"
ROOT="${NKLEIN_DRAINS_ROOT:-$HOME/.nklein/factory-drains}"
D="$ROOT/swebench-$ARM"
[[ -e "$D" ]] && { echo "arm dir exists: $D" >&2; exit 1; }
mkdir -p "$D/logs" "$D/workspaces" "$D/results" "$D/home/.nklein/nklein"
git -C "$REPO" worktree add --detach "$D/src" "$COMMIT" >/dev/null
( cd "$D/src" && rm -rf vendor && ln -s "$REPO/node_modules" node_modules && ln -s "$REPO/dist" dist && ln -s "$REPO/vendor" vendor )
# The `lms` CLI needs the real ~/.lmstudio even when HOME is redirected.
ln -sfn "$HOME/.lmstudio" "$D/home/.lmstudio"
python3 - "$D/home/.nklein/nklein/config.json" "$MODEL" <<'PY'
import json, sys
path, model = sys.argv[1], sys.argv[2]
pinned = {"providerId": "lmstudio", "modelId": model, "modelSelectionMode": "pinned"}
json.dump({
	"selectedAgentId": "nklein",
	"sandboxEgressAllowlist": "registry.npmjs.org",
	"developerModeEnabled": True,
	"setupWizardCompletedAt": 1789382481090,
	"sandboxEgressProxyEnabled": True,
	"maxConcurrentTasks": 1,
	"testDrivenModeEnabled": True,
	"modelRoles": {"architect": dict(pinned), "worker": dict(pinned), "reviewer": dict(pinned)},
}, open(path, "w"), indent=1)
PY
echo '{"providerId":"lmstudio"}' > "$D/home/.nklein/nklein/nklein-provider-selection.json"
cat > "$D/runtime.sh" <<EOF
#!/bin/zsh
# SWE-bench arm "$ARM": !Klein $COMMIT driving $MODEL from its own HOME on :$PORT. Infrastructure env only —
# no experiment flags: this measures !Klein as shipped at that commit.
D="$D"
cd "\$D/src" || exit 1
export HOME="\$D/home"
export NODE_ENV=development
export NODE_OPTIONS="--max-old-space-size=16384"
export NKLEIN_LOCAL_BASE_URL="http://127.0.0.1:1234/v1"
export NKLEIN_EGRESS_PROXY_BUNDLE="$REPO/dist/egress-proxy/entrypoint.mjs"
${IMAGE:+export NKLEIN_AGENT_SANDBOX_IMAGE="$IMAGE"}
export NKLEIN_MERGE_FALLBACK_MODEL="$MODEL" NKLEIN_CUSTODIAN_MODEL="$MODEL"
exec node_modules/.bin/tsx src/cli.ts --host 127.0.0.1 --port $PORT --no-open
EOF
cat > "$D/run.sh" <<EOF
#!/bin/zsh
# Usage: run.sh <instances|all> [max-wait-ms]
D="$D"
cd "$REPO" || exit 1
export HOME="\$D/home" NODE_ENV=development
exec node_modules/.bin/tsx scripts/swebench-tranche-run.mts \\
  --run-id "swebench-$ARM" --model "$MODEL" --runtime-host 127.0.0.1 --runtime-port $PORT --home "\$D/home" \\
  --instances "\${1:-all}" --max-wait-ms "\${2:-7200000}" $RUN_FLAGS \\
  --workspace-parent "\$D/workspaces" --out "\$D/results" --runtime-launcher "\$D/runtime.sh"
EOF
chmod +x "$D/runtime.sh" "$D/run.sh"
echo "arm ready: $D (model $MODEL, port $PORT, nklein $COMMIT${IMAGE:+, image $IMAGE})"

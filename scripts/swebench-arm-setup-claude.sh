#!/bin/zsh
# SWE-bench campaign — create a CLAUDE-SEAT arm: nklein driven by a Claude model (Sonnet/Opus) through the HITL model
# server + the claude-cli responder, everything else identical to a local-model arm.
#
#   scripts/swebench-arm-setup-claude.sh <arm> <claudeModel> <runtimePort> <hitlPort> <commit>
#   e.g. scripts/swebench-arm-setup-claude.sh sonnet5 claude-sonnet-5 3515 8096 83c39fe71
#
# Produces $NKLEIN_DRAINS_ROOT/swebench-<arm>/{src,home,queue,workspaces,results,logs,server.sh,responder.sh,runtime.sh,run.sh}.
# Start order: server.sh → responder.sh → runtime.sh → run.sh all. The model id on the wire is `<claudeModel>-hitl`;
# the responder writes queue/seat.json (CLI model + version) which the runner copies into every receipt.
set -euo pipefail
ARM="${1:?arm}"; CLAUDE_MODEL="${2:?claude model id}"; PORT="${3:?runtime port}"; HITL_PORT="${4:?hitl port}"; COMMIT="${5:?commit}"
REPO="${NKLEIN_REPO:-/Users/david/GIT/nklein}"
ROOT="${NKLEIN_DRAINS_ROOT:-$HOME/.nklein/factory-drains}"
D="$ROOT/swebench-$ARM"; MODEL_ID="$CLAUDE_MODEL-hitl"
[[ -e "$D" ]] && { echo "arm dir exists: $D" >&2; exit 1; }
mkdir -p "$D/logs" "$D/workspaces" "$D/results" "$D/queue" "$D/home/.nklein/nklein"
git -C "$REPO" worktree add --detach "$D/src" "$COMMIT" >/dev/null
( cd "$D/src" && rm -rf vendor && ln -s "$REPO/node_modules" node_modules && ln -s "$REPO/dist" dist && ln -s "$REPO/vendor" vendor )
ln -sfn "$HOME/.lmstudio" "$D/home/.lmstudio"
python3 - "$D/home/.nklein/nklein/config.json" "$MODEL_ID" <<'PY'
import json, sys
path, model = sys.argv[1], sys.argv[2]
pinned = {"providerId": "openai-compatible", "modelId": model, "modelSelectionMode": "pinned"}
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
( cd "$REPO" && HOME="$D/home" HITL_BASE_URL="http://127.0.0.1:$HITL_PORT/v1" HITL_MODEL_ID="$MODEL_ID" node_modules/.bin/tsx scripts/hitl-select-provider.mts )
cat > "$D/server.sh" <<EOF
#!/bin/zsh
# HITL model server for arm "$ARM": OpenAI-compatible endpoint on :$HITL_PORT, model id $MODEL_ID, answers from queue/.
export HITL_ROOT="$D/queue" HITL_PORT=$HITL_PORT HITL_MODEL_ID="$MODEL_ID" HITL_CTX=200000 HITL_ANSWER_TIMEOUT_S=5400
exec python3 "$ROOT/bin/hitl-model-server.py"
EOF
cat > "$D/responder.sh" <<EOF
#!/bin/zsh
# Claude responder for arm "$ARM": answers every queued request with \`claude -p --model $CLAUDE_MODEL\`.
export HITL_ROOT="$D/queue" CLAUDE_MODEL="$CLAUDE_MODEL" CLAUDE_RESPONDER_CONCURRENCY="${CLAUDE_RESPONDER_CONCURRENCY:-4}"
cd "$REPO" && exec node scripts/hitl-claude-responder.mjs
EOF
cat > "$D/runtime.sh" <<EOF
#!/bin/zsh
# SWE-bench arm "$ARM": !Klein $COMMIT driven by $CLAUDE_MODEL (HITL seat on :$HITL_PORT) from its own HOME on :$PORT.
# Same env as the HITL drain: no local LLM at all — custodian/merge-fallback off; long review walls (the seat answers at
# agent speed, not endpoint speed); alternate wires off.
D="$D"
cd "\$D/src" || exit 1
export HOME="\$D/home"
export NODE_ENV=development
export NODE_OPTIONS="--max-old-space-size=16384"
export NKLEIN_CUSTODIAN_MODEL="" NKLEIN_MERGE_FALLBACK_MODEL=""
export NKLEIN_REVIEW_TIMEOUT_MS=2400000 NKLEIN_REVIEW_VERDICT_RESERVE_MS=360000
export NKLEIN_EGRESS_PROXY_BUNDLE="$REPO/dist/egress-proxy/entrypoint.mjs"
export NKLEIN_ALTERNATE_ENDPOINT=off NKLEIN_SKILL_API_DIRECT=off
# P1.LOOPGUARDNUDGE: a headless run has nobody to answer a loop-guard park — one automatic re-drive per card first.
export NKLEIN_LOOP_GUARD_AUTO_NUDGE=1
# P1.SWEBENCHFULL: the sealed grader's flattened wheel caches as the sandbox's read-only wheelhouse (offline toolchain prime).
[[ -d "$REPO/.nklein-bench/swebench/wheels/_flat" ]] && export NKLEIN_AGENT_SANDBOX_WHEELHOUSE="$REPO/.nklein-bench/swebench/wheels/_flat"
exec node_modules/.bin/tsx src/cli.ts --host 127.0.0.1 --port $PORT --no-open
EOF
cat > "$D/run.sh" <<EOF
#!/bin/zsh
# Usage: run.sh <instances|all> [max-wait-ms]
D="$D"
cd "$REPO" || exit 1
export HOME="\$D/home" NODE_ENV=development
exec node_modules/.bin/tsx scripts/swebench-tranche-run.mts \\
  --run-id "swebench-$ARM" --model "$MODEL_ID" --seat-kind hitl --seat-file "\$D/queue/seat.json" \\
  --runtime-host 127.0.0.1 --runtime-port $PORT --home "\$D/home" \\
  --instances "\${1:-all}" --max-wait-ms "\${2:-7200000}" --no-plan \\
  --workspace-parent "\$D/workspaces" --out "\$D/results" --runtime-launcher "\$D/runtime.sh"
EOF
chmod +x "$D/server.sh" "$D/responder.sh" "$D/runtime.sh" "$D/run.sh"
echo "arm ready: $D (seat $CLAUDE_MODEL as $MODEL_ID on :$HITL_PORT, runtime :$PORT, nklein $COMMIT)"

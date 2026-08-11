#!/usr/bin/env bash
# scripts/real-model-run.sh — professional orchestration for REAL-MODEL !Klein runs.
#
# THE RULE (§4A): every real-model run goes through this script, never ad-hoc commands. It owns the whole
# lifecycle so a run can NEVER "just sit there" while a card stalls:
#   setup  — guarded retained-set admission at ≥32k, then LM Studio dev-log streaming (+ runtime for dev-test runs)
#   run    — launch the dev-test drain or deterministic role-eval harness (background)
#   watch  — ACTIVELY monitor from cheap sources (lms ps, the persisted board.json, the runtime log, the dev-log
#            stream) — NEVER polling the inference endpoint — and REACT to stall / crash / floor-refusal / success
#   report — assemble raw logs plus exact tool_use→tool_result pairs, errors, pending calls, board state, and transitions
#   teardown — always: kill the runtime + sandboxes; keep the fleet resident unless --unload
#
# Usage:  scripts/real-model-run.sh [preset] [--plan|--act] [--worker <modelId>] [--unload] [--max-min N]
#         scripts/real-model-run.sh [preset] --null-agent [--worker <modelId>] [--max-min N]
#         scripts/real-model-run.sh --eval-harness --worker <modelId> [--unload] [--max-min N]
#         scripts/real-model-run.sh --cache-probe --worker <modelId> [--unload] [--max-min N]
#         scripts/real-model-run.sh [wide_fanout] --fleet-swarm --worker <primaryWorkerId> [--max-min N]
# Env:    NKLEIN_RUN_HOME, NKLEIN_RUNTIME_PORT (3484), NKLEIN_STALL_SECS (180),
#         NKLEIN_ACTIVE_STALL_SECS (900), NKLEIN_POLL_SECS (15)
set -uo pipefail

usage(){
  cat <<'EOF'
Usage:
  scripts/real-model-run.sh [preset] [--plan|--act] [--worker <modelId>] [--max-min N] [--unload]
  scripts/real-model-run.sh [preset] --null-agent [--worker <modelId>] [--max-min N] [--unload]
  scripts/real-model-run.sh --eval-harness --worker <modelId> [--max-min N] [--unload]
  scripts/real-model-run.sh --cache-probe --worker <modelId> [--max-min N] [--unload]
  scripts/real-model-run.sh [wide_fanout] --fleet-swarm --worker <primaryWorkerId> [--max-min N]

Options:
  --plan            Run the planning/decomposition drain (default is --act).
  --act             Run the direct-action drain.
  --eval-harness    Run the deterministic per-role model evaluation without starting the !Klein runtime.
  --cache-probe     Assert repeated-prefix cache reuse through measured cold/warm time-to-first-token.
  --fleet-swarm     Run the heterogeneous fleet verifier; may inject NKLEIN_FLEET_FAULT_MODEL loss.
  --null-agent      Seed and grade the real dev-test pipeline without starting an agent.
  --worker ID       Model identifier to run and safely admit to the retained set.
  --max-min N       Hard wall-clock bound in whole minutes (default: 20).
  --unload          Unload all models during teardown (default: keep the safe retained set warm).
  --check-config    Validate and print the resolved run configuration without changing any state.
  -h, --help        Print this help without changing model or runtime state.

Environment:
  NKLEIN_FLEET="id ..." overrides the inferred dev-test fleet (at most NKLEIN_LOAD_MAX_RESIDENTS unique models).
  NKLEIN_LOAD_DEVICE explicitly selects the LM Link host (default: m5max).
  NKLEIN_LOAD_MAX_RESIDENTS caps that host's warm set (default and hard local ceiling: 3).
  NKLEIN_LOAD_TARGET_RAM_GB is required when the selected host is remote.
EOF
}

# ─────────────────────────────── config ───────────────────────────────
PORT="${NKLEIN_RUNTIME_PORT:-3484}"
TOKEN="${NKLEIN_INTERNAL_AUTH_TOKEN:-real-run-token-$$}"
POLL_SECS="${NKLEIN_POLL_SECS:-15}"       # how often the watcher samples (cheap sources only)
WORKER_MISSING_POLLS="${NKLEIN_WORKER_MISSING_POLLS:-2}" # LM Link can omit a remote host for one refresh after a load/unload
STALL_SECS="${NKLEIN_STALL_SECS:-180}"    # no board/tool/model-log progress this long ⇒ stall reaction
ACTIVE_STALL_SECS="${NKLEIN_ACTIVE_STALL_SECS:-900}" # active prefill/generation can be quiet; still bounded
CTX="${NKLEIN_CONTEXT_LENGTH:-32768}"     # ≥32k floor (prime directive #3) — MUST be met or sessions never start
LOAD_DEVICE="${NKLEIN_LOAD_DEVICE:-m5max}"
MAX_RESIDENTS="${NKLEIN_LOAD_MAX_RESIDENTS:-3}"

PRESET="mid_task"; PRESET_SET=0; MODE="--no-plan"; MODE_SET=0; RUN_KIND="dev-test"
WORKER=""; UNLOAD=0; MAX_MIN=20; CHECK_ONLY=0; NULL_AGENT=0
while [ "$#" -gt 0 ]; do
  case "$1" in
    -h|--help) usage; exit 0;;
    --plan) MODE=""; MODE_SET=1; shift;;
    --act) MODE="--no-plan"; MODE_SET=1; shift;;
    --eval-harness) RUN_KIND="eval"; shift;;
    --cache-probe) RUN_KIND="cache"; shift;;
    --fleet-swarm) RUN_KIND="fleet"; shift;;
    --null-agent) NULL_AGENT=1; shift;;
    --unload) UNLOAD=1; shift;;
    --check-config) CHECK_ONLY=1; shift;;
    --worker)
      [ "$#" -ge 2 ] && [ -n "$2" ] || { printf 'error: --worker requires a model identifier\n' >&2; usage >&2; exit 64; }
      WORKER="$2"; shift 2;;
    --max-min)
      [ "$#" -ge 2 ] && [ -n "$2" ] || { printf 'error: --max-min requires a positive integer\n' >&2; usage >&2; exit 64; }
      MAX_MIN="$2"; shift 2;;
    --*) printf 'error: unknown option: %s\n' "$1" >&2; usage >&2; exit 64;;
    *)
      [ "$PRESET_SET" = 0 ] || { printf 'error: unexpected positional argument: %s\n' "$1" >&2; usage >&2; exit 64; }
      PRESET="$1"; PRESET_SET=1; shift;;
  esac
done

case "$MAX_MIN" in ''|*[!0-9]*|0) printf 'error: --max-min must be a positive integer\n' >&2; exit 64;; esac
case "$WORKER_MISSING_POLLS" in ''|*[!0-9]*|0) printf 'error: NKLEIN_WORKER_MISSING_POLLS must be a positive integer\n' >&2; exit 64;; esac
case "$CTX" in ''|*[!0-9]*) printf 'error: NKLEIN_CONTEXT_LENGTH must be an integer ≥32000\n' >&2; exit 64;; esac
[ "$CTX" -ge 32000 ] || { printf 'error: NKLEIN_CONTEXT_LENGTH=%s violates the 32000-token floor\n' "$CTX" >&2; exit 64; }
case "$MAX_RESIDENTS" in ''|*[!0-9]*|0) printf 'error: NKLEIN_LOAD_MAX_RESIDENTS must be a positive integer\n' >&2; exit 64;; esac
[ "$MAX_RESIDENTS" -le 3 ] || { printf 'error: m5max retained-set safety ceiling is 3 models\n' >&2; exit 64; }
if [ "$RUN_KIND" != dev-test ] && [ "$RUN_KIND" != fleet ] && { [ "$PRESET_SET" = 1 ] || [ "$MODE_SET" = 1 ]; }; then
  printf 'error: presets and --plan/--act do not apply to eval/cache probes\n' >&2; exit 64
fi
[ "$RUN_KIND" = dev-test ] || [ "$NULL_AGENT" = 0 ] || {
  printf 'error: --null-agent applies only to dev-test runs\n' >&2; exit 64
}

WORKER="${WORKER:-qwen/qwen3.6-35b-a3b}"
ARCHITECT_MODEL="${NKLEIN_ARCHITECT_MODEL:-$WORKER}"
CHILD_WORKER_MODEL="${NKLEIN_CHILD_WORKER_MODEL:-qwen/qwen2.5-coder-14b}"
REVIEWER_MODEL="${NKLEIN_REVIEWER_MODEL:-$WORKER}"

# Infer only the models the requested run can actually use. Keep at most three warm on m5max; never preload a stale
# four-model roster. An explicit NKLEIN_FLEET remains available, but is rejected if it exceeds the declared cap.
FLEET=()
append_unique(){
  local candidate="$1" existing
  [ -n "$candidate" ] || return
  for existing in "${FLEET[@]-}"; do [ "$existing" = "$candidate" ] && return; done
  FLEET+=("$candidate")
}
if [ -n "${NKLEIN_FLEET:-}" ]; then
  read -r -a REQUESTED_FLEET <<< "$NKLEIN_FLEET"
  for model_id in "${REQUESTED_FLEET[@]}"; do append_unique "$model_id"; done
elif [ "$RUN_KIND" != dev-test ]; then
  append_unique "$WORKER"
elif [ -n "$MODE" ]; then
  append_unique "$WORKER"
else
  append_unique "$WORKER"
  append_unique "$ARCHITECT_MODEL"
  append_unique "$CHILD_WORKER_MODEL"
  append_unique "$REVIEWER_MODEL"
fi
[ "${#FLEET[@]}" -le "$MAX_RESIDENTS" ] || {
  printf 'error: requested fleet has %s unique models but the host cap is %s\n' "${#FLEET[@]}" "$MAX_RESIDENTS" >&2
  exit 64
}
if [ "$CHECK_ONLY" = 1 ]; then
  printf 'kind=%s preset=%s mode=%s nullAgent=%s worker=%s device=%s context=%s cap=%s fleet=[%s]\n' \
    "$RUN_KIND" "$PRESET" "${MODE:-plan}" "$NULL_AGENT" "$WORKER" "$LOAD_DEVICE" "$CTX" "$MAX_RESIDENTS" "${FLEET[*]}"
  exit 0
fi

REPO="$(cd "$(dirname "$0")/.." && pwd)"
STAMP="$(date +%Y%m%d-%H%M%S)"
RUN_DIR="$REPO/.real-runs/$STAMP"
# A shared HOME contaminates one run's evidence with prior sessions and ledgers. Each run owns a fresh HOME by default;
# an explicit NKLEIN_RUN_HOME remains available for a deliberate resume/reproduction.
RUN_HOME="${NKLEIN_RUN_HOME:-$RUN_DIR/home}"
mkdir -p "$RUN_DIR" "$RUN_HOME"
RUNTIME_LOG="$RUN_DIR/runtime.log"; DRAIN_JSON="$RUN_DIR/drain.json"; DRAIN_ERR="$RUN_DIR/drain.err"
DEVLOG="$RUN_DIR/lmstudio-devlog.txt"; RUNLOG="$RUN_DIR/orchestrator.log"; SNAP="$RUN_DIR/snapshots.log"
EVIDENCE_DIR="$RUN_DIR/evidence"
SESSION_SNAPSHOT_DIR="$RUN_HOME/.nklein/evidence-session-snapshots"

# The isolated HOME must still be a runnable !Klein installation. Configure the resident fleet as the role fallback
# so decomposition children do not strand with "No native !Klein provider is configured" after a forced seed model.
RUN_CONFIG="$RUN_HOME/.nklein/nklein/config.json"
PROVIDER_SELECTION="$RUN_HOME/.nklein/nklein/nklein-provider-selection.json"
if [ "$RUN_KIND" = dev-test ]; then
  mkdir -p "$(dirname "$RUN_CONFIG")" "$SESSION_SNAPSHOT_DIR"
fi
if [ "$RUN_KIND" = dev-test ] && [ ! -f "$RUN_CONFIG" ]; then
  jq -n --arg architect "$ARCHITECT_MODEL" --arg worker "$CHILD_WORKER_MODEL" --arg reviewer "$REVIEWER_MODEL" '{
    selectedAgentId: "nklein",
    developerModeEnabled: true,
    modelRoles: {
      architect: {providerId: "lmstudio", modelId: $architect},
      worker: {providerId: "lmstudio", modelId: $worker},
      reviewer: {providerId: "lmstudio", modelId: $reviewer}
    }
  }' >"$RUN_CONFIG"
fi
# modelRoles choose models after a role has been assigned; the auto-start cascade still resolves the globally
# selected provider before applying those overrides. Reproduce the local-provider onboarding state inside the
# isolated HOME rather than borrowing the developer's real HOME (which would contaminate run evidence).
if [ "$RUN_KIND" = dev-test ] && [ ! -f "$PROVIDER_SELECTION" ]; then
  jq -n '{providerId: "lmstudio"}' >"$PROVIDER_SELECTION"
fi

log(){ printf '%s %s\n' "$(date +%H:%M:%S)" "$*" | tee -a "$RUNLOG"; }
REAL_HOME="$HOME"; DEVLOG_PID=""; RUNTIME_PID=""; DRAIN_PID=""; TEARDOWN_DONE=0; RUN_LOCK_HELD=0
RUN_LOCK="$REPO/.real-runs/.controller.lock"
RUN_PHASE="setup"; SIGNAL_ABORT_REASON=""; SIGNAL_EXIT_STATUS=0

terminate_process_tree(){
  local parent="$1" child
  [ -n "$parent" ] || return
  for child in $(pgrep -P "$parent" 2>/dev/null); do terminate_process_tree "$child"; done
  kill -TERM "$parent" 2>/dev/null || true
}

stop_process_tree(){
  local parent="$1" i
  [ -n "$parent" ] || return
  kill -0 "$parent" 2>/dev/null || return
  terminate_process_tree "$parent"
  for i in $(seq 1 20); do kill -0 "$parent" 2>/dev/null || return; sleep 0.25; done
  kill -KILL "$parent" 2>/dev/null || true
}

# ─────────────────────────────── teardown (always) ───────────────────────────────
teardown(){
  [ "$TEARDOWN_DONE" = 1 ] && return
  TEARDOWN_DONE=1
  log "TEARDOWN"
  stop_process_tree "$DRAIN_PID"
  stop_process_tree "$RUNTIME_PID"
  [ -n "$DEVLOG_PID" ] && kill "$DEVLOG_PID" 2>/dev/null
  SANDBOX_COUNT=0
  if [ "$RUN_KIND" = dev-test ] || [ "$RUN_KIND" = fleet ]; then
    for container_id in $(HOME="$REAL_HOME" docker ps -aq --filter 'name=nklein-agent-sandbox' 2>/dev/null); do
      HOME="$REAL_HOME" docker rm -f "$container_id" >/dev/null 2>&1 && SANDBOX_COUNT=$((SANDBOX_COUNT + 1))
    done
  fi
  [ "$SANDBOX_COUNT" -gt 0 ] && log "removed $SANDBOX_COUNT sandbox container(s)"
  if [ "$UNLOAD" = 1 ]; then HOME="$REAL_HOME" lms unload --all 2>/dev/null | tail -1 | xargs log; else log "fleet kept resident (use --unload to free)"; fi
  sleep 1
  if [ "$RUN_KIND" = dev-test ]; then
    HOME="$REAL_HOME" lsof -iTCP:"$PORT" -sTCP:LISTEN -P 2>/dev/null | grep -q LISTEN && log "⚠ port $PORT still busy" || log "port $PORT free"
  fi
  if [ "$RUN_LOCK_HELD" = 1 ]; then
    rm -f "$RUN_LOCK/owner.pid"
    rmdir "$RUN_LOCK" 2>/dev/null || true
    RUN_LOCK_HELD=0
  fi
  log "run dir: $RUN_DIR"
}

handle_signal(){
  SIGNAL_ABORT_REASON="$1"
  SIGNAL_EXIT_STATUS="$2"
  # During watch, return control to the loop so it stops the drain and preserves evidence.
  # Before a drain exists there is nothing meaningful to report, so ordinary teardown is sufficient.
  [ "$RUN_PHASE" = "watch" ] || exit "$SIGNAL_EXIT_STATUS"
}

# ─────────────────────────────── setup ───────────────────────────────
log "=== REAL-MODEL RUN $STAMP  kind=$RUN_KIND preset=$PRESET mode=${MODE:-plan} worker=$WORKER fleet=[${FLEET[*]}] ==="
[ "$RUN_KIND" = dev-test ] && log "isolated role config: architect=$ARCHITECT_MODEL worker=$CHILD_WORKER_MODEL reviewer=$REVIEWER_MODEL"
# Do not arm teardown until this controller exclusively owns the lifecycle. A rejected concurrent launch must never
# remove another run's Docker sandboxes (real incident: a port-conflict exit destroyed the active run's container).
if [ "$RUN_KIND" = dev-test ]; then
  HOME="$REAL_HOME" lsof -iTCP:"$PORT" -sTCP:LISTEN -P 2>/dev/null | grep -q LISTEN && { log "FATAL: port $PORT already in use; leaving its owner untouched"; exit 2; }
fi
if mkdir "$RUN_LOCK" 2>/dev/null; then
  RUN_LOCK_HELD=1
else
  LOCK_OWNER="$(cat "$RUN_LOCK/owner.pid" 2>/dev/null || true)"
  if [ -z "$LOCK_OWNER" ]; then
    sleep 1
    LOCK_OWNER="$(cat "$RUN_LOCK/owner.pid" 2>/dev/null || true)"
  fi
  if [ -z "$LOCK_OWNER" ] || ! kill -0 "$LOCK_OWNER" 2>/dev/null; then
    rm -f "$RUN_LOCK/owner.pid"
    rmdir "$RUN_LOCK" 2>/dev/null || true
  fi
  mkdir "$RUN_LOCK" 2>/dev/null && RUN_LOCK_HELD=1
fi
if [ "$RUN_LOCK_HELD" != 1 ]; then
  log "FATAL: another real-model controller owns $RUN_LOCK; leaving it untouched"
  exit 2
fi
printf '%s\n' "$$" >"$RUN_LOCK/owner.pid"
trap teardown EXIT
trap 'handle_signal interrupted 130' INT
trap 'handle_signal terminated 143' TERM

if [ "$RUN_KIND" = fleet ]; then
  log "fleet verifier owns an already-resident multi-host roster; it will fail closed rather than move/load models"
else
  log "admitting retained fleet on $LOAD_DEVICE at ${CTX} ctx (≥32k floor, cap $MAX_RESIDENTS)…"
  LOAD_FAILURES=0
  for m in "${FLEET[@]}"; do
    LOAD_LOG="$RUN_DIR/load-$(echo "$m" | tr '/@:' '____').log"
    if ( cd "$REPO" && HOME="$REAL_HOME" \
         NKLEIN_LOAD_DEVICE="$LOAD_DEVICE" NKLEIN_LOAD_MAX_RESIDENTS="$MAX_RESIDENTS" \
         NKLEIN_LOAD_PINNED_MODELS="${NKLEIN_RETAIN_MODELS:-} ${FLEET[*]}" \
         "$REPO/node_modules/.bin/tsx" scripts/model-lab.mts admit "$m" "$CTX" ) >"$LOAD_LOG" 2>&1; then
      log "  ✓ admitted $m; warm-set policy reconciled"
    else
      log "  ✗ REFUSED $m — see $(basename "$LOAD_LOG")"
      LOAD_FAILURES=$((LOAD_FAILURES + 1))
    fi
  done
  [ "$LOAD_FAILURES" -eq 0 ] || { log "FATAL: $LOAD_FAILURES required model admission(s) failed"; exit 3; }
fi
PS_JSON=$(HOME="$REAL_HOME" lms ps --json 2>/dev/null || true)
RESIDENT=$(printf '%s' "$PS_JSON" | jq '[.[] | select(.type == "llm")] | length' 2>/dev/null || echo 0)
LOCAL_RESIDENT=$(printf '%s' "$PS_JSON" | jq '[.[] | select(.type == "llm" and .deviceIdentifier == null)] | length' 2>/dev/null || echo 0)
log "resident models across LM Link: $RESIDENT (local m5max: $LOCAL_RESIDENT)"
[ "$RESIDENT" -lt 1 ] && { log "FATAL: no models resident"; exit 3; }

log "starting LM Studio dev-log stream → $(basename "$DEVLOG")"
( HOME="$REAL_HOME" lms log stream >"$DEVLOG" 2>&1 ) & DEVLOG_PID=$!

if [ "$RUN_KIND" = dev-test ]; then
  log "starting !Klein runtime on :$PORT (HOME=$RUN_HOME)…"
  ( cd "$REPO" && HOME="$RUN_HOME" NKLEIN_RUNTIME_PORT="$PORT" NKLEIN_INTERNAL_AUTH_TOKEN="$TOKEN" NODE_ENV=development \
    NKLEIN_EVIDENCE_SESSION_SNAPSHOT_DIR="$SESSION_SNAPSHOT_DIR" \
    NKLEIN_TOOL_GATE_OBSERVE=1 \
    `# P15.3: the default-flip campaign can only ever conclude from REAL-model observations, and this emitter is` \
    `# opt-in and default-OFF. A drain that never sets it produces zero observations, so 'dev mechanism-decision'` \
    `# reports insufficient_data forever and reads as "keep running" when in fact nothing was being gathered.` \
    `# Safe to turn on here by construction: the registry classifies it mode: "observe_only" — it records a` \
    `# counterfactual and changes no behaviour. ENFORCE stays off, which is the whole point of observe-first.` \
    `# --no-open: a rig runtime must NEVER open a browser tab on the operator's machine (the drain script had` \
    `# the same omission — David's machine collected 7 dead tabs before it was found there; fixed in both).` \
      "$REPO/node_modules/.bin/tsx" src/cli.ts --port "$PORT" --no-open >"$RUNTIME_LOG" 2>&1 ) & RUNTIME_PID=$!
  for i in $(seq 1 40); do HOME="$REAL_HOME" lsof -iTCP:"$PORT" -sTCP:LISTEN -P 2>/dev/null | grep -q LISTEN && break; sleep 1; done
  HOME="$REAL_HOME" lsof -iTCP:"$PORT" -sTCP:LISTEN -P 2>/dev/null | grep -q LISTEN || { log "FATAL: runtime did not come up"; exit 4; }
  log "runtime UP"
fi

# ─────────────────────────────── run ───────────────────────────────
DRAIN_START=$(date +%s)
if [ "$RUN_KIND" = eval ]; then
  DRAIN_JSON="$RUN_DIR/eval.log"; DRAIN_ERR="$RUN_DIR/eval.err"
  log "launching role eval: worker=$WORKER max=${MAX_MIN}m"
  ( cd "$REPO" && HOME="$RUN_HOME" NKLEIN_VERIFY_MODEL="$WORKER" \
      NKLEIN_VERIFY_BASE_URL="http://127.0.0.1:1234/v1" \
      NKLEIN_EVAL_CHECKPOINT_PATH="$RUN_DIR/eval-checkpoint.json" \
      "$REPO/node_modules/.bin/tsx" scripts/eval-harness.mts >"$DRAIN_JSON" 2>"$DRAIN_ERR" ) & DRAIN_PID=$!
elif [ "$RUN_KIND" = cache ]; then
  DRAIN_JSON="$RUN_DIR/cache-probe.log"; DRAIN_ERR="$RUN_DIR/cache-probe.err"
  log "launching cache-health probe: worker=$WORKER max=${MAX_MIN}m"
  ( cd "$REPO" && HOME="$RUN_HOME" NKLEIN_VERIFY_MODEL="$WORKER" \
      NKLEIN_VERIFY_BASE_URL="http://127.0.0.1:1234/v1" \
      "$REPO/node_modules/.bin/tsx" scripts/verify-cache-health-live.mts >"$DRAIN_JSON" 2>"$DRAIN_ERR" ) & DRAIN_PID=$!
elif [ "$RUN_KIND" = fleet ]; then
  DRAIN_JSON="$RUN_DIR/fleet-swarm.log"; DRAIN_ERR="$RUN_DIR/fleet-swarm.err"
  log "launching heterogeneous fleet verifier: preset=$PRESET worker=$WORKER fault=${NKLEIN_FLEET_FAULT_MODEL:-none} max=${MAX_MIN}m"
  ( cd "$REPO" && HOME="$REAL_HOME" NKLEIN_VERIFY_PRESET="$PRESET" NKLEIN_FLEET_WORKER="$WORKER" \
      NKLEIN_VERIFY_TIMEOUT_MS=$((MAX_MIN*60000)) \
      "$REPO/node_modules/.bin/tsx" scripts/verify-fleet-swarm.mts >"$DRAIN_JSON" 2>"$DRAIN_ERR" ) & DRAIN_PID=$!
else
  # P23.5 resume-mode: NKLEIN_RESUME_PROJECT_PATH (with NKLEIN_RUN_HOME persisted across cycles) monitors the
  # EXISTING board instead of scaffolding+seeding — run N+1 attacks the graph's deeper cards. Fresh-workspace
  # runs are measurement-stationary; resuming is the honest path to "is the domain slice reachable locally".
  if [ -n "${NKLEIN_RESUME_PROJECT_PATH:-}" ]; then
    [ -n "${NKLEIN_RUN_HOME:-}" ] || { log "FATAL: resume mode requires NKLEIN_RUN_HOME (the persisted home whose board is being resumed)"; exit 64; }
    log "launching RESUME drain: project=$NKLEIN_RESUME_PROJECT_PATH worker=$WORKER max=${MAX_MIN}m"
    ( cd "$REPO" && HOME="$RUN_HOME" NKLEIN_RUNTIME_PORT="$PORT" NKLEIN_INTERNAL_AUTH_TOKEN="$TOKEN" NODE_ENV=development \
        "$REPO/node_modules/.bin/tsx" src/cli.ts dev test-project --preset "$PRESET" --resume \
          --project-path "$NKLEIN_RESUME_PROJECT_PATH" \
          --model-id "$WORKER" --provider-id lmstudio \
          --max-wait-ms $((MAX_MIN*60000)) --poll-interval-ms 10000 --json \
          >"$DRAIN_JSON" 2>"$DRAIN_ERR" ) & DRAIN_PID=$!
  else
  log "launching drain: preset=$PRESET mode=${MODE:-plan} worker=$WORKER max=${MAX_MIN}m"
  NULL_AGENT_ARG=""
  [ "$NULL_AGENT" = 1 ] && NULL_AGENT_ARG="--null-agent"
  ( cd "$REPO" && HOME="$RUN_HOME" NKLEIN_RUNTIME_PORT="$PORT" NKLEIN_INTERNAL_AUTH_TOKEN="$TOKEN" NODE_ENV=development \
      "$REPO/node_modules/.bin/tsx" src/cli.ts dev test-project --preset "$PRESET" $MODE $NULL_AGENT_ARG \
        --model-id "$WORKER" --provider-id lmstudio \
        --max-wait-ms $((MAX_MIN*60000)) --poll-interval-ms 10000 --json \
        >"$DRAIN_JSON" 2>"$DRAIN_ERR" ) & DRAIN_PID=$!
  fi
fi

# ─────────────────────────────── watch + react ───────────────────────────────
board_signature(){  # cheap board state from the persisted json (NO api call): "col=count|col=count", non-empty cols only
  local f; f=$(ls -t "$RUN_HOME"/.nklein/nklein/workspaces/*/board.json 2>/dev/null | head -1)
  [ -z "$f" ] && return
  python3 - "$f" <<'PY' 2>/dev/null
import json,sys
try: d=json.load(open(sys.argv[1]))
except Exception: sys.exit()
board=d.get("board",d) if isinstance(d,dict) else {}
cols=board.get("columns",[]) if isinstance(board,dict) else []
print("|".join(f"{c.get('id')}={len(c.get('cards',[]))}" for c in cols if c.get('cards')))
PY
}
tool_activity(){    # exact use/result/error/pending counts across persisted transcripts (NO api call)
  local uses=0 results=0 errors=0 counts file_uses file_results file_errors
  for f in "$RUN_HOME"/.nklein/data/sessions/*/*.messages.json; do
    [ -f "$f" ] || continue
    counts=$(jq -r '
      def nested_failure:
        if type == "array" then any(.[]; nested_failure)
        elif type == "object" then
          (.success == false or .ok == false or .is_error == true or .isError == true or any(.[]; nested_failure))
        elif type == "string" then (try (fromjson | nested_failure) catch false)
        else false end;
      [
      ([.messages[]?.content[]? | select(.type == "tool_use")] | length),
      ([.messages[]?.content[]? | select(.type == "tool_result")] | length),
      ([.messages[]?.content[]? | select(.type == "tool_result" and (.is_error == true or (.content | nested_failure)))] | length)
    ] | @tsv' "$f" 2>/dev/null) || continue
    IFS=$'\t' read -r file_uses file_results file_errors <<< "$counts"
    uses=$((uses + ${file_uses:-0})); results=$((results + ${file_results:-0})); errors=$((errors + ${file_errors:-0}))
  done
  echo "uses=$uses,results=$results,errors=$errors,pending=$((uses-results))"
}
snapshot_session_transcripts(){ # auxiliary sessions are cleared after use; preserve their latest complete live image
  local f
  for f in "$RUN_HOME"/.nklein/data/sessions/*/*.messages.json; do
    [ -f "$f" ] || continue
    cp "$f" "$SESSION_SNAPSHOT_DIR/$(basename "$f")" 2>/dev/null || true
  done
}
drain_semantic_signature(){ # raw verifier output includes repeated scheduler bookkeeping that is not work progress
  [ -f "$DRAIN_JSON" ] || { echo "0 0"; return; }
  # Keep board changes, WS activity, fault/recovery events, verifier assertions, and arbitrary harness output. Remove only
  # proven periodic scheduler/capacity lines that can grow forever while every card/model is otherwise motionless.
  grep -Ev \
    '(^|\] )Board-liveness watchdog:|(^|\] )Auto-start of .* (queued behind a busy endpoint\.|hit the concurrency limit; deferred for retry on the next completion\.)$|(^|\] )Model turn for .* is waiting for capacity:' \
    "$DRAIN_JSON" 2>/dev/null | cksum | awk '{print $1 " " $2}'
}
# N15 local-only assertion — DEFAULT ON since 2026-08-10 (NKLEIN_EGRESS_AUDIT=0 disables): each poll appends the RUN pid tree's ESTABLISHED
# TCP rows to egress-audit.samples; `dev connection-audit` judges them at report time. Pid-tree scoping keeps
# the host's unrelated apps out of the verdict; docker'd sandbox agents live in their own netns and are
# governed by the container network config, so host lsof correctly excludes them.
run_pid_tree(){
  local roots="$RUNTIME_PID $DRAIN_PID $$" all="" frontier next
  frontier="$roots"
  while [ -n "$frontier" ]; do
    all="$all $frontier"
    next=$(pgrep -P "$(echo "$frontier" | tr ' ' ',')" 2>/dev/null | tr '\n' ' ')
    frontier="$next"
  done
  echo "$all" | tr ' ' '\n' | grep -E '^[0-9]+$' | sort -u | tr '\n' ',' | sed 's/,$//'
}
EGRESS_AUDIT_SAMPLES="$RUN_DIR/egress-audit.samples"
sample_run_connections(){
  # Default-ON: two PASSing audited runs (2026-08-04 sh, 2026-08-10 mts) cleared the "once quiet" gate.
  [ "${NKLEIN_EGRESS_AUDIT:-1}" = 1 ] || return 0
  local pids; pids=$(run_pid_tree)
  [ -n "$pids" ] || return 0
  lsof -a -p "$pids" -nP -iTCP -sTCP:ESTABLISHED 2>/dev/null >>"$EGRESS_AUDIT_SAMPLES" || true
}
LAST_SIG=""; LAST_CHANGE=$(date +%s); ABORT_REASON=""; RUN_PHASE="watch"; WORKER_MISS_COUNT=0
while kill -0 "$DRAIN_PID" 2>/dev/null; do
  sleep "$POLL_SECS"
  kill -0 "$DRAIN_PID" 2>/dev/null || break
  if [ -n "$SIGNAL_ABORT_REASON" ]; then
    ABORT_REASON="$SIGNAL_ABORT_REASON"
    log "REACT: received $SIGNAL_ABORT_REASON — stopping the drain and preserving evidence."
    break
  fi
  sample_run_connections
  snapshot_session_transcripts
  NOW=$(date +%s); ELAPSED=$((NOW-DRAIN_START))
  if [ "$ELAPSED" -ge $((MAX_MIN*60)) ]; then
    ABORT_REASON="wall_clock_limit"
    log "REACT: hard wall-clock limit ${MAX_MIN}m reached — stopping the run and preserving evidence."
    break
  fi
  PS_JSON=$(HOME="$REAL_HOME" lms ps --json 2>/dev/null || true)
  MSTAT=$(printf '%s' "$PS_JSON" | jq -r '.[] | select(.type == "llm" and (.status != null and .status != "idle")) | .identifier' 2>/dev/null | tr '\n' ',')
  SIG=$(board_signature); TOOLS=$(tool_activity); DEVLOG_BYTES=$(wc -c <"$DEVLOG" 2>/dev/null || echo 0)
  DEVLOG_BYTES="${DEVLOG_BYTES//[[:space:]]/}"
  DRAIN_BYTES=$(wc -c <"$DRAIN_JSON" 2>/dev/null || echo 0)
  DRAIN_BYTES="${DRAIN_BYTES//[[:space:]]/}"
  DRAIN_SEMANTIC_SIG=$(drain_semantic_signature)
  printf '%s elapsed=%ss board=[%s] tool-evidence=[%s] model-log-bytes=[%s] drain-bytes=[%s] drain-semantic=[%s] active=[%s]\n' "$(date +%H:%M:%S)" "$ELAPSED" "${SIG:-?}" "$TOOLS" "${DEVLOG_BYTES:-0}" "${DRAIN_BYTES:-0}" "${DRAIN_SEMANTIC_SIG:-0 0}" "${MSTAT:-idle}" | tee -a "$SNAP"
  # REACT: floor refusal (config error — abort, it will never start)
  if [ "$RUN_KIND" = dev-test ] && HOME="$REAL_HOME" grep -q 'before this model can be activated' "$RUNTIME_LOG" 2>/dev/null; then
    ABORT_REASON="context_floor_refusal"
    log "REACT: context-floor refusal in runtime log — a model is loaded below ${CTX}. Aborting (fix the load)."; break; fi
  # REACT: isolated/provider onboarding is incomplete — children can never auto-start in this run.
  if [ "$RUN_KIND" = dev-test ] && HOME="$REAL_HOME" grep -q 'No native !Klein provider is configured' "$RUNTIME_LOG" 2>/dev/null; then
    ABORT_REASON="provider_unconfigured"
    log "REACT: auto-start has no native provider selection. Aborting (fix isolated onboarding state)."; break; fi
  # REACT: sandbox/docker conflict repeatedly failing
  if [ "$RUN_KIND" = dev-test ] && [ "$(HOME="$REAL_HOME" grep -c 'is already in use by container' "$RUNTIME_LOG" 2>/dev/null)" -gt 3 ]; then
    ABORT_REASON="sandbox_container_conflict"
    log "REACT: repeated sandbox container-name conflict — stale containers. Aborting; teardown will clear them."; break; fi
  # REACT: the required worker disappeared. LM Link briefly returned an incomplete cross-host snapshot immediately
  # after a deliberate remote unload in run 20260722-042353, while the required worker remained resident. Debounce
  # only the inventory observation; the authoritative backend-crash stream below still aborts on its first signal.
  if printf '%s' "$PS_JSON" | jq -e --arg worker "$WORKER" '
    any(.[]; .type == "llm" and (.identifier == $worker or .modelKey == $worker or .indexedModelIdentifier == $worker))
  ' >/dev/null 2>&1; then
    WORKER_MISS_COUNT=0
  else
    WORKER_MISS_COUNT=$((WORKER_MISS_COUNT + 1))
    if [ "$WORKER_MISS_COUNT" -ge "$WORKER_MISSING_POLLS" ]; then
      ABORT_REASON="worker_unloaded"
      log "REACT: required worker $WORKER was absent from $WORKER_MISS_COUNT consecutive resident snapshots. Aborting before requests churn."; break
    fi
    log "OBSERVE: required worker $WORKER absent from resident snapshot $WORKER_MISS_COUNT/$WORKER_MISSING_POLLS; waiting for LM Link reconciliation."
  fi
  # REACT: LM Studio can leave a crashed model nominally IDLE. The dev stream is the authoritative backend signal.
  if grep -Eiq 'fatal exception in the backend generation thread|model has crashed' "$DEVLOG" 2>/dev/null; then
    ABORT_REASON="backend_crash"
    log "REACT: LM Studio reported a fatal backend generation crash. Aborting and preserving the exact dev log."; break; fi
  # progress tracking
  CURSIG="$SIG|$TOOLS|devlog=${DEVLOG_BYTES:-0}|drain-semantic=${DRAIN_SEMANTIC_SIG:-0 0}"
  if [ "$CURSIG" != "$LAST_SIG" ]; then LAST_SIG="$CURSIG"; LAST_CHANGE="$NOW"; fi
  IDLE_FOR=$((NOW-LAST_CHANGE))
  # LM Studio can spend several minutes in PROCESSINGPROMPT without advancing its dev-log stream (real Qwen2.5
  # 32k prefill evidence). Keep active work bounded, but do not apply the tighter genuinely-idle threshold to it.
  STALL_LIMIT="$STALL_SECS"; STALL_KIND="idle"
  if [ -n "$MSTAT" ]; then STALL_LIMIT="$ACTIVE_STALL_SECS"; STALL_KIND="active-model"; fi
  if [ "$IDLE_FOR" -ge "$STALL_LIMIT" ]; then
    ABORT_REASON="stalled"
    log "REACT: STALL ($STALL_KIND) — no board/tool/model-log progress for ${IDLE_FOR}s (limit ${STALL_LIMIT}s). Snapshotting + aborting."
    { echo "=== STALL SNAPSHOT ==="; echo "board: $SIG"; echo "runtime log tail:"; tail -20 "$RUNTIME_LOG"; } >>"$SNAP"; break; fi
done

# ─────────────────────────────── report ───────────────────────────────
[ -z "$ABORT_REASON" ] && [ -n "$SIGNAL_ABORT_REASON" ] && ABORT_REASON="$SIGNAL_ABORT_REASON"
RUN_PHASE="report"
if [ -n "$ABORT_REASON" ] && kill -0 "$DRAIN_PID" 2>/dev/null; then
  log "stopping drain immediately after reactive abort ($ABORT_REASON)"
  stop_process_tree "$DRAIN_PID"
fi
wait "$DRAIN_PID" 2>/dev/null; DRAIN_STATUS=$?; DRAIN_END=$(date +%s)
log "=== RESULT (real wall time $((DRAIN_END-DRAIN_START))s) ==="
snapshot_session_transcripts
DRAIN_OUTCOME="unclassified"; DRAIN_SUCCESS=false
if [ "$RUN_KIND" = eval ] || [ "$RUN_KIND" = cache ] || [ "$RUN_KIND" = fleet ]; then
  if [ "$DRAIN_STATUS" -eq 0 ]; then
    DRAIN_OUTCOME="passed"; DRAIN_SUCCESS=true
  elif [ "$RUN_KIND" = eval ] && [ "$DRAIN_STATUS" -eq 3 ]; then
    DRAIN_OUTCOME="partial"
  else
    DRAIN_OUTCOME="failed"
  fi
  EVAL_RESULT=$(grep -E '^(result:|verdict:|SWEEP-ROW)' "$DRAIN_JSON" 2>/dev/null | tail -1)
  log "$RUN_KIND outcome: $DRAIN_OUTCOME | ${EVAL_RESULT:-no result line; see run logs}"
elif jq -e '.classification' "$DRAIN_JSON" >/dev/null 2>&1; then
  RAW_DRAIN_OUTCOME=$(jq -r '.classification.outcome // "unclassified"' "$DRAIN_JSON")
  RAW_DRAIN_SUCCESS=$(jq -r '.classification.success // false' "$DRAIN_JSON")
  if [ "$NULL_AGENT" = 1 ]; then
    if [ "$RAW_DRAIN_SUCCESS" = false ]; then
      DRAIN_OUTCOME="null_agent_rejected"; DRAIN_SUCCESS=true
    else
      DRAIN_OUTCOME="null_agent_forged"; DRAIN_SUCCESS=false
    fi
    log "outcome: $DRAIN_OUTCOME | grader=$RAW_DRAIN_OUTCOME success=$RAW_DRAIN_SUCCESS | counts: $(jq -c '.finalCounts' "$DRAIN_JSON")"
  else
    DRAIN_OUTCOME="$RAW_DRAIN_OUTCOME"; DRAIN_SUCCESS="$RAW_DRAIN_SUCCESS"
    log "outcome: $DRAIN_OUTCOME | success: $DRAIN_SUCCESS | counts: $(jq -c '.finalCounts' "$DRAIN_JSON")"
  fi
else
  log "no classification (see drain.json/err)"
  tail -3 "$DRAIN_JSON" 2>/dev/null
  tail -3 "$DRAIN_ERR" 2>/dev/null
fi

jq -n \
  --arg abortReason "$ABORT_REASON" \
  --arg outcome "$DRAIN_OUTCOME" \
  --argjson success "$DRAIN_SUCCESS" \
  --argjson drainExitCode "$DRAIN_STATUS" \
  --argjson durationSeconds "$((DRAIN_END-DRAIN_START))" \
  '{abortReason: (if $abortReason == "" then null else $abortReason end), outcome: $outcome, success: $success, drainExitCode: $drainExitCode, durationSeconds: $durationSeconds}' \
  >"$RUN_DIR/controller-result.json"

# N15: judge the recorded connection samples — PASS / FAIL / INDETERMINATE ride the report; a FAIL names
# each destination. Allowlist comes from NKLEIN_EGRESS_AUDIT_ALLOW (comma-separated, e.g. fleet hosts).
if [ "${NKLEIN_EGRESS_AUDIT:-0}" = 1 ]; then
  if AUDIT_OUT=$("$REPO/node_modules/.bin/tsx" "$REPO/src/cli.ts" dev connection-audit \
      --samples "$EGRESS_AUDIT_SAMPLES" ${NKLEIN_EGRESS_AUDIT_ALLOW:+--allow "$NKLEIN_EGRESS_AUDIT_ALLOW"} 2>&1); then
    log "$AUDIT_OUT"
  else
    log "⚠ $AUDIT_OUT"
  fi
fi

if [ "$RUN_KIND" = dev-test ]; then
  log "collecting exact transcripts, tool results, errors, pending calls, board state, and transitions"
  EVIDENCE_SUMMARY=$("$REPO/node_modules/.bin/tsx" "$REPO/src/commands/real-model-evidence-cli.ts" \
    --home "$RUN_HOME" --out "$EVIDENCE_DIR" --runtime-log "$RUNTIME_LOG" 2>"$RUN_DIR/evidence-collector.err")
  EVIDENCE_STATUS=$?
  if [ "$EVIDENCE_STATUS" -eq 0 ]; then
    log "evidence: $EVIDENCE_SUMMARY"
  else
    log "⚠ evidence collection reported errors (exit $EVIDENCE_STATUS); see evidence/summary.json + evidence-collector.err"
  fi
  log "logs: runtime.log, lmstudio-devlog.txt, snapshots.log, drain.json, controller-result.json, evidence/ in $RUN_DIR"
elif [ "$RUN_KIND" = eval ]; then
  log "logs: eval.log, eval.err, lmstudio-devlog.txt, snapshots.log, controller-result.json in $RUN_DIR"
elif [ "$RUN_KIND" = fleet ]; then
  log "logs: fleet-swarm.log, fleet-swarm.err, lmstudio-devlog.txt, snapshots.log, controller-result.json in $RUN_DIR"
else
  log "logs: cache-probe.log, cache-probe.err, lmstudio-devlog.txt, snapshots.log, controller-result.json in $RUN_DIR"
fi
if [ "$RUN_KIND" = eval ] || [ "$RUN_KIND" = cache ] || [ "$RUN_KIND" = fleet ]; then
  FINAL_STATUS="$DRAIN_STATUS"
  [ -n "$ABORT_REASON" ] && FINAL_STATUS=1
else
  FINAL_STATUS=0
  if [ "$DRAIN_STATUS" -ne 0 ] || [ "$DRAIN_SUCCESS" != true ] || [ -n "$ABORT_REASON" ]; then FINAL_STATUS=1; fi
fi
log "controller exit: $FINAL_STATUS"
exit "$FINAL_STATUS"
# teardown runs on EXIT

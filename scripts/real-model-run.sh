#!/usr/bin/env bash
# scripts/real-model-run.sh — professional orchestration for REAL-MODEL !Klein runs.
#
# THE RULE (§4A): every real-model run goes through this script, never ad-hoc commands. It owns the whole
# lifecycle so a run can NEVER "just sit there" while a card stalls:
#   setup  — pin m5max, load the resident fleet at ≥32k, start LM Studio dev-log streaming, start the !Klein runtime
#   run    — launch the dev-test drain (background)
#   watch  — ACTIVELY monitor from cheap sources (lms ps, the persisted board.json, the runtime log, the dev-log
#            stream) — NEVER polling the inference endpoint — and REACT to stall / crash / floor-refusal / success
#   report — assemble raw logs plus exact tool_use→tool_result pairs, errors, pending calls, board state, and transitions
#   teardown — always: kill the runtime + sandboxes; keep the fleet resident unless --unload
#
# Usage:  scripts/real-model-run.sh [preset] [--plan|--act] [--worker <modelId>] [--unload] [--max-min N]
# Env:    NKLEIN_RUN_HOME, NKLEIN_RUNTIME_PORT (3484), NKLEIN_STALL_SECS (180),
#         NKLEIN_ACTIVE_STALL_SECS (900), NKLEIN_POLL_SECS (15)
set -uo pipefail

# ─────────────────────────────── config ───────────────────────────────
PORT="${NKLEIN_RUNTIME_PORT:-3484}"
TOKEN="${NKLEIN_INTERNAL_AUTH_TOKEN:-real-run-token-$$}"
POLL_SECS="${NKLEIN_POLL_SECS:-15}"       # how often the watcher samples (cheap sources only)
STALL_SECS="${NKLEIN_STALL_SECS:-180}"    # no board/tool/model-log progress this long ⇒ stall reaction
ACTIVE_STALL_SECS="${NKLEIN_ACTIVE_STALL_SECS:-900}" # active prefill/generation can be quiet; still bounded
CTX="${NKLEIN_CONTEXT_LENGTH:-32768}"     # ≥32k floor (prime directive #3) — MUST be met or sessions never start
M5MAX_DEVICE="${NKLEIN_M5MAX_DEVICE:-}"   # optional lms device identifier to pin (auto-detected if empty)

PRESET="mid_task"; MODE="--no-plan"; WORKER=""; UNLOAD=0; MAX_MIN=20
for arg in "$@"; do case "$arg" in
  --plan) MODE="";; --act) MODE="--no-plan";;
  --unload) UNLOAD=1;;
  --worker) NEXT_IS_WORKER=1;;
  --max-min) NEXT_IS_MAX=1;;
  *) if [ "${NEXT_IS_WORKER:-0}" = 1 ]; then WORKER="$arg"; NEXT_IS_WORKER=0;
     elif [ "${NEXT_IS_MAX:-0}" = 1 ]; then MAX_MIN="$arg"; NEXT_IS_MAX=0;
     else PRESET="$arg"; fi;;
esac; done

# The resident fleet — small + fast, kept loaded on m5max (David 2026-07-21). Override with NKLEIN_FLEET="a b c".
DEFAULT_FLEET="qwen/qwen3.6-35b-a3b google/gemma-4-31b-qat qwopus3.5-9b-coder-mlx@8bit qwen/qwen2.5-coder-14b"
read -r -a FLEET <<< "${NKLEIN_FLEET:-$DEFAULT_FLEET}"
WORKER="${WORKER:-qwen/qwen3.6-35b-a3b}"

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
ARCHITECT_MODEL="${NKLEIN_ARCHITECT_MODEL:-$WORKER}"
CHILD_WORKER_MODEL="${NKLEIN_CHILD_WORKER_MODEL:-qwen/qwen2.5-coder-14b}"
REVIEWER_MODEL="${NKLEIN_REVIEWER_MODEL:-google/gemma-4-31b-qat}"
RUN_CONFIG="$RUN_HOME/.nklein/nklein/config.json"
PROVIDER_SELECTION="$RUN_HOME/.nklein/nklein/nklein-provider-selection.json"
mkdir -p "$(dirname "$RUN_CONFIG")" "$SESSION_SNAPSHOT_DIR"
if [ ! -f "$RUN_CONFIG" ]; then
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
if [ ! -f "$PROVIDER_SELECTION" ]; then
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
  for container_id in $(HOME="$REAL_HOME" docker ps -aq --filter 'name=nklein-agent-sandbox' 2>/dev/null); do
    HOME="$REAL_HOME" docker rm -f "$container_id" >/dev/null 2>&1 && SANDBOX_COUNT=$((SANDBOX_COUNT + 1))
  done
  [ "$SANDBOX_COUNT" -gt 0 ] && log "removed $SANDBOX_COUNT sandbox container(s)"
  if [ "$UNLOAD" = 1 ]; then HOME="$REAL_HOME" lms unload --all 2>/dev/null | tail -1 | xargs log; else log "fleet kept resident (use --unload to free)"; fi
  sleep 1
  HOME="$REAL_HOME" lsof -iTCP:"$PORT" -sTCP:LISTEN -P 2>/dev/null | grep -q LISTEN && log "⚠ port $PORT still busy" || log "port $PORT free"
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
log "=== REAL-MODEL RUN $STAMP  preset=$PRESET mode=${MODE:-plan} worker=$WORKER fleet=[${FLEET[*]}] ==="
log "isolated role config: architect=$ARCHITECT_MODEL worker=$CHILD_WORKER_MODEL reviewer=$REVIEWER_MODEL"
# Do not arm teardown until this controller exclusively owns the lifecycle. A rejected concurrent launch must never
# remove another run's Docker sandboxes (real incident: a port-conflict exit destroyed the active run's container).
HOME="$REAL_HOME" lsof -iTCP:"$PORT" -sTCP:LISTEN -P 2>/dev/null | grep -q LISTEN && { log "FATAL: port $PORT already in use; leaving its owner untouched"; exit 2; }
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

# Pin m5max so loads land on the fast box, not an auto-routed remote.
if [ -z "$M5MAX_DEVICE" ]; then M5MAX_DEVICE="$(HOME="$REAL_HOME" lms link set-preferred-device 2>&1 | grep -iE 'm5max' | grep -oE '[0-9a-f]{32}' | head -1)"; fi
[ -n "$M5MAX_DEVICE" ] && { HOME="$REAL_HOME" lms link set-preferred-device "$M5MAX_DEVICE" >/dev/null 2>&1 && log "pinned m5max ($M5MAX_DEVICE)"; }

log "loading fleet at ${CTX} ctx (≥32k floor)…"
for m in "${FLEET[@]}"; do
  if HOME="$REAL_HOME" lms ps 2>/dev/null | grep -q "$m"; then log "  ✓ $m already resident"; continue; fi
  if HOME="$REAL_HOME" lms load "$m" --context-length "$CTX" --gpu max -y >"$RUN_DIR/load-$(echo "$m"|tr '/@' '__').log" 2>&1; then
    dev=$(HOME="$REAL_HOME" lms ps 2>/dev/null | grep "$m" | grep -oiE 'Local|m5max|m4mini|legion[0-9a-z]*' | head -1)
    log "  ✓ loaded $m (device ${dev:-?})"
  else log "  ✗ FAILED to load $m — see load log"; fi
done
RESIDENT=$(HOME="$REAL_HOME" lms ps 2>/dev/null | grep -cE 'IDLE|GENERAT|PROCESS'); log "resident models: $RESIDENT"
[ "$RESIDENT" -lt 1 ] && { log "FATAL: no models resident"; exit 3; }

log "starting LM Studio dev-log stream → $(basename "$DEVLOG")"
( HOME="$REAL_HOME" lms log stream >"$DEVLOG" 2>&1 ) & DEVLOG_PID=$!

log "starting !Klein runtime on :$PORT (HOME=$RUN_HOME)…"
( cd "$REPO" && HOME="$RUN_HOME" NKLEIN_RUNTIME_PORT="$PORT" NKLEIN_INTERNAL_AUTH_TOKEN="$TOKEN" NODE_ENV=development \
	NKLEIN_EVIDENCE_SESSION_SNAPSHOT_DIR="$SESSION_SNAPSHOT_DIR" \
    npx tsx src/cli.ts --port "$PORT" >"$RUNTIME_LOG" 2>&1 ) & RUNTIME_PID=$!
for i in $(seq 1 40); do HOME="$REAL_HOME" lsof -iTCP:"$PORT" -sTCP:LISTEN -P 2>/dev/null | grep -q LISTEN && break; sleep 1; done
HOME="$REAL_HOME" lsof -iTCP:"$PORT" -sTCP:LISTEN -P 2>/dev/null | grep -q LISTEN || { log "FATAL: runtime did not come up"; exit 4; }
log "runtime UP"

# ─────────────────────────────── run ───────────────────────────────
log "launching drain: preset=$PRESET mode=${MODE:-plan} worker=$WORKER max=${MAX_MIN}m"
DRAIN_START=$(date +%s)
( cd "$REPO" && HOME="$RUN_HOME" NKLEIN_RUNTIME_PORT="$PORT" NKLEIN_INTERNAL_AUTH_TOKEN="$TOKEN" NODE_ENV=development \
    npx tsx src/cli.ts dev test-project --preset "$PRESET" $MODE \
      --model-id "$WORKER" --provider-id lmstudio \
      --max-wait-ms $((MAX_MIN*60000)) --poll-interval-ms 10000 --json \
      >"$DRAIN_JSON" 2>"$DRAIN_ERR" ) & DRAIN_PID=$!

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
LAST_SIG=""; LAST_CHANGE=$(date +%s); ABORT_REASON=""; RUN_PHASE="watch"
while kill -0 "$DRAIN_PID" 2>/dev/null; do
  sleep "$POLL_SECS"
  if [ -n "$SIGNAL_ABORT_REASON" ]; then
    ABORT_REASON="$SIGNAL_ABORT_REASON"
    log "REACT: received $SIGNAL_ABORT_REASON — stopping the drain and preserving evidence."
    break
  fi
  snapshot_session_transcripts
  NOW=$(date +%s); ELAPSED=$((NOW-DRAIN_START))
  MSTAT=$(HOME="$REAL_HOME" lms ps 2>/dev/null | grep -iE 'GENERAT|PROCESS' | awk '{print $1}' | tr '\n' ',' )
  SIG=$(board_signature); TOOLS=$(tool_activity); DEVLOG_BYTES=$(wc -c <"$DEVLOG" 2>/dev/null || echo 0)
  DEVLOG_BYTES="${DEVLOG_BYTES//[[:space:]]/}"
  printf '%s elapsed=%ss board=[%s] tool-evidence=[%s] model-log-bytes=[%s] active=[%s]\n' "$(date +%H:%M:%S)" "$ELAPSED" "${SIG:-?}" "$TOOLS" "${DEVLOG_BYTES:-0}" "${MSTAT:-idle}" | tee -a "$SNAP"
  # REACT: floor refusal (config error — abort, it will never start)
  if HOME="$REAL_HOME" grep -q 'before this model can be activated' "$RUNTIME_LOG" 2>/dev/null; then
    ABORT_REASON="context_floor_refusal"
    log "REACT: context-floor refusal in runtime log — a model is loaded below ${CTX}. Aborting (fix the load)."; break; fi
  # REACT: isolated/provider onboarding is incomplete — children can never auto-start in this run.
  if HOME="$REAL_HOME" grep -q 'No native !Klein provider is configured' "$RUNTIME_LOG" 2>/dev/null; then
    ABORT_REASON="provider_unconfigured"
    log "REACT: auto-start has no native provider selection. Aborting (fix isolated onboarding state)."; break; fi
  # REACT: sandbox/docker conflict repeatedly failing
  if [ "$(HOME="$REAL_HOME" grep -c 'is already in use by container' "$RUNTIME_LOG" 2>/dev/null)" -gt 3 ]; then
    ABORT_REASON="sandbox_container_conflict"
    log "REACT: repeated sandbox container-name conflict — stale containers. Aborting; teardown will clear them."; break; fi
  # progress tracking
  CURSIG="$SIG|$TOOLS|devlog=${DEVLOG_BYTES:-0}"
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
if jq -e '.classification' "$DRAIN_JSON" >/dev/null 2>&1; then
  DRAIN_OUTCOME=$(jq -r '.classification.outcome // "unclassified"' "$DRAIN_JSON")
  DRAIN_SUCCESS=$(jq -r '.classification.success // false' "$DRAIN_JSON")
  log "outcome: $DRAIN_OUTCOME | success: $DRAIN_SUCCESS | counts: $(jq -c '.finalCounts' "$DRAIN_JSON")"
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
FINAL_STATUS=0
if [ "$DRAIN_STATUS" -ne 0 ] || [ "$DRAIN_SUCCESS" != true ] || [ -n "$ABORT_REASON" ]; then FINAL_STATUS=1; fi
log "controller exit: $FINAL_STATUS"
exit "$FINAL_STATUS"
# teardown runs on EXIT

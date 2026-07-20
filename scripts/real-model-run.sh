#!/usr/bin/env bash
# scripts/real-model-run.sh — professional orchestration for REAL-MODEL !Klein runs.
#
# THE RULE (§4A): every real-model run goes through this script, never ad-hoc commands. It owns the whole
# lifecycle so a run can NEVER "just sit there" while a card stalls:
#   setup  — pin m5max, load the resident fleet at ≥32k, start LM Studio dev-log streaming, start the !Klein runtime
#   run    — launch the dev-test drain (background)
#   watch  — ACTIVELY monitor from cheap sources (lms ps, the persisted board.json, the runtime log, the dev-log
#            stream) — NEVER polling the inference endpoint — and REACT to stall / crash / floor-refusal / success
#   report — assemble every log + the classification into one run directory
#   teardown — always: kill the runtime + sandboxes; keep the fleet resident unless --unload
#
# Usage:  scripts/real-model-run.sh [preset] [--plan|--act] [--worker <modelId>] [--unload] [--max-min N]
# Env:    NKLEIN_RUN_HOME, NKLEIN_RUNTIME_PORT (3484), NKLEIN_STALL_SECS (180), NKLEIN_POLL_SECS (15)
set -uo pipefail

# ─────────────────────────────── config ───────────────────────────────
PORT="${NKLEIN_RUNTIME_PORT:-3484}"
TOKEN="${NKLEIN_INTERNAL_AUTH_TOKEN:-real-run-token-$$}"
POLL_SECS="${NKLEIN_POLL_SECS:-15}"       # how often the watcher samples (cheap sources only)
STALL_SECS="${NKLEIN_STALL_SECS:-180}"    # no board change AND model idle this long ⇒ stall reaction
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
RUN_HOME="${NKLEIN_RUN_HOME:-$REPO/.real-runs/home}"
RUN_DIR="$REPO/.real-runs/$STAMP"; mkdir -p "$RUN_DIR" "$RUN_HOME"
RUNTIME_LOG="$RUN_DIR/runtime.log"; DRAIN_JSON="$RUN_DIR/drain.json"; DRAIN_ERR="$RUN_DIR/drain.err"
DEVLOG="$RUN_DIR/lmstudio-devlog.txt"; RUNLOG="$RUN_DIR/orchestrator.log"; SNAP="$RUN_DIR/snapshots.log"

log(){ printf '%s %s\n' "$(date +%H:%M:%S)" "$*" | tee -a "$RUNLOG"; }
REAL_HOME="$HOME"; DEVLOG_PID=""; RUNTIME_PID=""; DRAIN_PID=""

# ─────────────────────────────── teardown (always) ───────────────────────────────
teardown(){
  log "TEARDOWN"
  [ -n "$DRAIN_PID" ] && kill "$DRAIN_PID" 2>/dev/null; pkill -f "test-project --preset $PRESET" 2>/dev/null
  pkill -f "tsx src/cli.ts --port $PORT" 2>/dev/null
  [ -n "$DEVLOG_PID" ] && kill "$DEVLOG_PID" 2>/dev/null
  HOME="$REAL_HOME" docker rm -f $(HOME="$REAL_HOME" docker ps -aq --filter 'name=nklein-agent-sandbox' 2>/dev/null) 2>/dev/null | grep -c . | xargs -I{} log "removed {} sandbox container(s)"
  if [ "$UNLOAD" = 1 ]; then HOME="$REAL_HOME" lms unload --all 2>/dev/null | tail -1 | xargs log; else log "fleet kept resident (use --unload to free)"; fi
  sleep 1
  HOME="$REAL_HOME" lsof -iTCP:"$PORT" -sTCP:LISTEN -P 2>/dev/null | grep -q LISTEN && log "⚠ port $PORT still busy" || log "port $PORT free"
  log "run dir: $RUN_DIR"
}
trap teardown EXIT INT TERM

# ─────────────────────────────── setup ───────────────────────────────
log "=== REAL-MODEL RUN $STAMP  preset=$PRESET mode=${MODE:-plan} worker=$WORKER fleet=[${FLEET[*]}] ==="
HOME="$REAL_HOME" lsof -iTCP:"$PORT" -sTCP:LISTEN -P 2>/dev/null | grep -q LISTEN && { log "FATAL: port $PORT already in use"; exit 2; }

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
rm -rf "$RUN_HOME"/.nklein/dev-workspaces/* 2>/dev/null
( cd "$REPO" && HOME="$RUN_HOME" NKLEIN_RUNTIME_PORT="$PORT" NKLEIN_INTERNAL_AUTH_TOKEN="$TOKEN" NODE_ENV=development \
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
  local f; f=$(ls -t "$RUN_HOME"/.nklein/dev-workspaces/*/.nklein/nklein/workspace/board.json 2>/dev/null | head -1)
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
tool_activity(){    # total tool_use blocks across session transcripts (NO api call)
  local n=0 c
  for f in "$RUN_HOME"/.nklein/data/sessions/*/*.messages.json; do
    [ -f "$f" ] || continue
    c=$(grep -oc '"tool_use"' "$f" 2>/dev/null); n=$((n + ${c:-0}))
  done
  echo "$n"
}
LAST_SIG=""; LAST_CHANGE=$(date +%s)
while kill -0 "$DRAIN_PID" 2>/dev/null; do
  sleep "$POLL_SECS"
  NOW=$(date +%s); ELAPSED=$((NOW-DRAIN_START))
  MSTAT=$(HOME="$REAL_HOME" lms ps 2>/dev/null | grep -iE 'GENERAT|PROCESS' | awk '{print $1}' | tr '\n' ',' )
  SIG=$(board_signature); TOOLS=$(tool_activity)
  printf '%s elapsed=%ss board=[%s] tools=%s active=[%s]\n' "$(date +%H:%M:%S)" "$ELAPSED" "${SIG:-?}" "${TOOLS:-0}" "${MSTAT:-idle}" | tee -a "$SNAP"
  # REACT: floor refusal (config error — abort, it will never start)
  if HOME="$REAL_HOME" grep -q 'before this model can be activated' "$RUNTIME_LOG" 2>/dev/null; then
    log "REACT: context-floor refusal in runtime log — a model is loaded below ${CTX}. Aborting (fix the load)."; break; fi
  # REACT: sandbox/docker conflict repeatedly failing
  if [ "$(HOME="$REAL_HOME" grep -c 'is already in use by container' "$RUNTIME_LOG" 2>/dev/null)" -gt 3 ]; then
    log "REACT: repeated sandbox container-name conflict — stale containers. Aborting; teardown will clear them."; break; fi
  # progress tracking
  CURSIG="$SIG|$TOOLS"
  if [ "$CURSIG" != "$LAST_SIG" ]; then LAST_SIG="$CURSIG"; LAST_CHANGE="$NOW"; fi
  IDLE_FOR=$((NOW-LAST_CHANGE))
  # REACT: stall — no board/tool change AND no model generating for STALL_SECS
  if [ "$IDLE_FOR" -ge "$STALL_SECS" ] && [ -z "$MSTAT" ]; then
    log "REACT: STALL — no board/tool progress and no model active for ${IDLE_FOR}s. Snapshotting + aborting."
    { echo "=== STALL SNAPSHOT ==="; echo "board: $SIG"; echo "runtime log tail:"; tail -20 "$RUNTIME_LOG"; } >>"$SNAP"; break; fi
done

# ─────────────────────────────── report ───────────────────────────────
wait "$DRAIN_PID" 2>/dev/null; DRAIN_END=$(date +%s)
log "=== RESULT (real wall time $((DRAIN_END-DRAIN_START))s) ==="
HOME="$REAL_HOME" python3 -c "import json;d=json.load(open('$DRAIN_JSON'));c=d.get('classification',{});print('outcome:',c.get('outcome'),'| success:',c.get('success'),'| counts:',d.get('finalCounts'))" 2>/dev/null | tee -a "$RUNLOG" \
  || { log "no classification (see drain.json/err)"; tail -3 "$DRAIN_JSON" 2>/dev/null; tail -3 "$DRAIN_ERR" 2>/dev/null; }
log "logs: runtime.log, lmstudio-devlog.txt, snapshots.log, drain.json in $RUN_DIR"
# teardown runs on EXIT

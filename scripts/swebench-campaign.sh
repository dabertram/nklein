#!/bin/zsh
# SWE-bench campaign orchestrator — run prepared arms ONE AT A TIME on the shared m5max slot.
#
#   scripts/swebench-campaign.sh <docsDir> <arm>:<modelKey>:<port>:<contextLength> [...]
#
# For each arm (created by scripts/swebench-arm-setup.sh): wait until no tranche runner is active, load the model
# BESIDE whatever is loaded (never unloads a model it did not load — the operator's models stay loaded), start the
# arm's runtime, run all ten instances, unload only the model it loaded, and copy the results into <docsDir>/<arm>/.
# Refuses an arm whose model does not fit (`lms load --estimate-only`) and moves on, saying so in the campaign log.
set -uo pipefail
DOCS="${1:?docs dir}"; shift
ROOT="${NKLEIN_DRAINS_ROOT:-$HOME/.nklein/factory-drains}"
LOG="$ROOT/swebench-campaign.log"
say() { echo "[$(date +%H:%M:%S)] $*" | tee -a "$LOG"; }
wait_idle_runner() { while pgrep -f "swebench-tranche-run.mts" >/dev/null; do sleep 60; done; }
for spec in "$@"; do
	IFS=':' read -r ARM MODEL PORT CTX <<< "$spec"
	D="$ROOT/swebench-$ARM"
	[[ -x "$D/run.sh" ]] || { say "SKIP $ARM: $D/run.sh missing (run swebench-arm-setup.sh first)"; continue; }
	say "arm $ARM: waiting for the slot (no tranche runner active)"
	wait_idle_runner
	LOADED_BY_ME=0
	if lms ps --json 2>/dev/null | python3 -c "import json,sys; sys.exit(0 if any(m.get('modelKey')=='$MODEL' or m.get('identifier')=='$MODEL' for m in json.load(sys.stdin)) else 1)"; then
		say "arm $ARM: $MODEL already loaded (operator's) — using it as is"
	else
		if ! lms load "$MODEL" --estimate-only -c "$CTX" >>"$LOG" 2>&1; then
			say "SKIP $ARM: $MODEL does not fit beside the loaded models (estimate refused) — needs the operator"
			continue
		fi
		say "arm $ARM: loading $MODEL at context $CTX"
		if ! lms load "$MODEL" -c "$CTX" -y >>"$LOG" 2>&1; then say "SKIP $ARM: load failed"; continue; fi
		LOADED_BY_ME=1
	fi
	if ! curl -s -o /dev/null --max-time 3 "http://127.0.0.1:$PORT/health"; then
		say "arm $ARM: starting runtime on :$PORT"
		nohup "$D/runtime.sh" > "$D/logs/runtime.log" 2>&1 &
		for i in $(seq 1 60); do curl -s -o /dev/null --max-time 3 "http://127.0.0.1:$PORT/health" && break; sleep 2; done
	fi
	if ! curl -s -o /dev/null --max-time 3 "http://127.0.0.1:$PORT/health"; then say "SKIP $ARM: runtime on :$PORT never became healthy"; continue; fi
	say "arm $ARM: running all instances (log $D/logs/run-campaign.log)"
	"$D/run.sh" all 7200000 > "$D/logs/run-campaign.log" 2>&1
	say "arm $ARM: finished — $(tail -1 "$D/logs/run-campaign.log" | cut -c1-160)"
	mkdir -p "$DOCS/$ARM" && cp "$D/results/"*.json "$D/results/"summary.md "$D/results/"summary.jsonl "$DOCS/$ARM/" 2>/dev/null
	if [[ $LOADED_BY_ME -eq 1 ]]; then say "arm $ARM: unloading $MODEL (loaded by this campaign)"; lms unload "$MODEL" >>"$LOG" 2>&1 || say "unload of $MODEL failed — leave it to the operator"; fi
done
say "campaign done"

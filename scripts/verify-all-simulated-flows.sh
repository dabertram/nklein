#!/bin/zsh
# F11.4c — the aimock COMPLETENESS invariant: every dev-test scenario set (01–20) must drain to Completed
# through the deterministic simulator, perfect AND flaky runs, with zero unmatched requests.
#
# SEQUENTIAL by design: parallel drains of the large sets starve each other's in-scenario `npm test` steps and
# false-timeout (live-hit 2026-07-11). Each run gets a fresh isolated HOME under /tmp; a failure is loud and the
# sweep continues so one broken set reports alongside the others instead of masking them.
#
# Usage: scripts/verify-all-simulated-flows.sh [first] [last]     (defaults 01..20)
set -u
cd "$(dirname "$0")/.."
first=${1:-1}
last=${2:-20}
failures=()
port_base=${NKLEIN_SIMFLOW_PORT_BASE:-4300}
for n in $(seq -f "%02g" "$first" "$last"); do
	for run in perfect flaky; do
		home=$(mktemp -d "/tmp/nklein-simflow-${n}-${run}-XXXX")
		# Per-run port: the harness's fixed default (3986) is the stale-server trap — a lingering runtime from the
		# previous scenario (or any concurrent harness) gets "already running"-reused and reads as unreachable.
		port=$((port_base + 10#$n * 2 + $([ "$run" = "flaky" ] && echo 1 || echo 0)))
		echo "== scenario $n ($run) on :$port =="
		if HOME="$home" NKLEIN_SIMFLOW_SCENARIO="$n" NKLEIN_SIMFLOW_RUN="$run" NKLEIN_SIMFLOW_RUNTIME_PORT="$port" \
			npx tsx scripts/verify-simulated-flow.mts >"$home/drain.log" 2>&1; then
			grep -E "PASS" "$home/drain.log" | tail -1
		else
			echo "FAIL scenario $n ($run) — log: $home/drain.log"
			tail -5 "$home/drain.log"
			failures+=("$n/$run")
		fi
	done
done
echo ""
if [ ${#failures[@]} -eq 0 ]; then
	echo "ALL SETS DRAIN CLEAN ✓ (${first}..${last}, perfect+flaky)"
else
	echo "FAILURES: ${failures[*]}"
	exit 1
fi

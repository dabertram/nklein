#!/usr/bin/env bash
# P23.6 — the variant DELTA measurement: run one real model against BOTH spec variants of project 18 and grade
# both with the SAME held-out oracle. The delta between them is the item's research output.
#
# ── WHAT THIS DOES NOT DO ──
# Never loads or unloads a model. The resident set is the operator's (standing directive) — this script asserts
# a model is already loaded and refuses otherwise, rather than helpfully loading one.
#
# ── SEQUENTIAL ON PURPOSE ──
# Parallel real-model drains starve each other's turns and false-timeout (§4A). Two legs, one after the other.
#
# ── WHY BOTH LEGS SHARE ONE ORACLE ──
# The prescriptive variant hands the agent a file map and interfaces; the discovery variant hands it vision,
# invariants, threats and acceptance ONLY. "Grade both with the same oracle" collides with "no prescribed
# interfaces", and the resolution is that the discovery variant pins exactly ONE thing — a public entry point —
# with architecture free behind it. `resolve-operations.mts` binds to the OPERATION wherever each variant's own
# contract puts it, and throws loudly when neither exists, so "the agent built nothing callable" can never read
# as "the probe found nothing to assert".
set -euo pipefail

MAX_MIN="${MAX_MIN:-150}"
OUT="${OUT:-$HOME/nklein-p23.6-$(date +%Y%m%d-%H%M%S)}"
PROJECT="18_semiconductor_fab_mes_yield_platform"
WS="dev-test-projects/$PROJECT"
PROBES="test/protected/oracle/$PROJECT"

mkdir -p "$OUT"
echo "output: $OUT"

# FAIL FAST on the precondition, rather than discovering it 150 minutes in. A model below the ≥32k floor never
# starts a session at all, and the board just shows a watchdog sweeping forever — silent except in the log.
if ! lms ps 2>/dev/null | grep -qE '[0-9]{5,}'; then
  echo "REFUSING: no model with a 5+ digit context is loaded. Load one (>= 32000) and re-run; this script" >&2
  echo "          never loads or unloads — the resident set is the operator's." >&2
  exit 2
fi
echo "resident model:"; lms ps 2>/dev/null | sed 's/^/  /'

run_leg() {
  local leg="$1" spec="$2"
  echo "--- leg $leg: $spec ---"
  cp "$WS/$spec" "$OUT/$leg-prompt.txt"
  npx tsx scripts/real-model-drain.mts \
    --workspace "$WS" \
    --prompt-file "$OUT/$leg-prompt.txt" \
    --out "$OUT/$leg-ws" --max-min "$MAX_MIN" > "$OUT/$leg-drain.log" 2>&1 || true

  npx tsx -e "
import { resolve } from 'node:path';
import { runHeldOutOracle } from './src/core/held-out-oracle-runner';
const v = await runHeldOutOracle({
  workspaceDir: resolve('$OUT/$leg-ws'),
  probeDir: resolve('$PROBES'),
});
console.log('ORACLE:', v.passed, '/', v.results.length);
for (const r of v.results) console.log(' ', r.probe.id, r.passed ? 'PASS' : 'fail');
" > "$OUT/$leg-oracle.log" 2>&1 || true
  echo "leg $leg oracle: $(grep -E '^ORACLE:' "$OUT/$leg-oracle.log" || echo 'see log')"
}

run_leg prescriptive specification.md
run_leg discovery    specification-discovery.md

echo
echo "=== THE DELTA (the item's actual output) ==="
grep -H -E '^ORACLE:' "$OUT"/*-oracle.log || echo "no oracle verdicts — read the drain logs before concluding anything"
echo
echo "⚠ A missing verdict is NOT a score of zero: it means the leg produced nothing gradeable, which is a"
echo "  different fact from the agent scoring badly. Read $OUT/*-drain.log before reporting a delta."
echo
echo "TEARDOWN (yours to run — this script starts no server, but a drain may leave sandboxes):"
echo "  docker ps -aq --filter name=nklein-agent-sandbox | xargs -r docker rm -f"

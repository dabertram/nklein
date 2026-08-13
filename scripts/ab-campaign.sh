#!/usr/bin/env bash
# scripts/ab-campaign.sh — P15.3 fork (a): the PAIRED A/B campaign for act-when-ON flags.
#
# A mechanism that ACTS when enabled has no observe-first counterfactual — its evidence is the paired
# comparison: the same task set drained with the flag OFF (arm A) and ON (arm B), outcomes joined per pair,
# decided by decideDefaultFlip (McNemar + minimum practical effect). This runner produces those pairs
# HONESTLY:
#   · both arms go through scripts/real-model-run.sh (§4A: never ad-hoc drains), sequentially (never parallel);
#   · the pairing unit is (preset, pair-index) — the same task CONTENT in both arms;
#   · each pair appends to a durable ledger (~/nklein-ab-campaigns/<flag>.jsonl) so evidence ACCUMULATES
#     across invocations — the P25.3 lesson: throwaway homes accumulate nothing;
#   · the verdict step runs decideDefaultFlip on ALL accumulated pairs and prints it — insufficient pairs is
#     the expected early answer, not a failure.
#
# Usage: scripts/ab-campaign.sh <FLAG> [--presets p1,p2,...] [--repeat N] [--max-min M] [--verdict-only]
# Example: scripts/ab-campaign.sh NKLEIN_MODEL_CONSULT --presets mid_task,deep_chain --repeat 2 --max-min 30
set -uo pipefail

FLAG="${1:-}"; shift || true
[ -n "$FLAG" ] || { echo "usage: scripts/ab-campaign.sh <FLAG> [--presets list] [--repeat N] [--max-min M] [--verdict-only]" >&2; exit 64; }
case "$FLAG" in NKLEIN_*) ;; *) echo "error: '$FLAG' does not look like an NKLEIN_* flag" >&2; exit 64;; esac

PRESETS="mid_task"; REPEAT=1; MAX_MIN=30; VERDICT_ONLY=0
while [ "$#" -gt 0 ]; do
  case "$1" in
    --presets) PRESETS="$2"; shift 2;;
    --repeat) REPEAT="$2"; shift 2;;
    --max-min) MAX_MIN="$2"; shift 2;;
    --verdict-only) VERDICT_ONLY=1; shift;;
    *) echo "error: unknown option $1" >&2; exit 64;;
  esac
done
case "$REPEAT" in ''|*[!0-9]*|0) echo "error: --repeat must be a positive integer" >&2; exit 64;; esac

REPO="$(cd "$(dirname "$0")/.." && pwd)"
# The rig's idle-stall kill is DISABLED-in-effect for campaign arms (window = the arm's own wall + slack):
# 600s was not enough, and the deeper finding is that idle-kills here are not noise — the flag UNDER TEST
# changes idle patterns (a stuck consult-OFF arm goes quiet; a consult-ON arm stays active), so stall-kills
# systematically censor exactly the pairs where the mechanism matters. Within a bounded arm, every run must
# reach a CONTROLLER classification (complete, settle, or max-wait) so every pair records an outcome.
export NKLEIN_STALL_SECS="${NKLEIN_STALL_SECS:-$((MAX_MIN * 60 + 300))}"
CAMPAIGN_DIR="$HOME/nklein-ab-campaigns"
PAIRS_FILE="$CAMPAIGN_DIR/$FLAG.jsonl"
mkdir -p "$CAMPAIGN_DIR"

run_arm(){ # $1 = preset, $2 = flag value ("" for off / "1" for on) → echoes "true"/"false"/"error"
  local preset="$1" flagValue="$2" runDirBefore runDirAfter outcome
  runDirBefore="$(ls -dt "$REPO"/.real-runs/*/ 2>/dev/null | head -1 || true)"
  if [ -n "$flagValue" ]; then
    env "$FLAG=$flagValue" "$REPO/scripts/real-model-run.sh" "$preset" --act --max-min "$MAX_MIN" >/dev/null 2>&1
  else
    env -u "$FLAG" "$REPO/scripts/real-model-run.sh" "$preset" --act --max-min "$MAX_MIN" >/dev/null 2>&1
  fi
  runDirAfter="$(ls -dt "$REPO"/.real-runs/*/ 2>/dev/null | head -1 || true)"
  if [ -z "$runDirAfter" ] || [ "$runDirAfter" = "$runDirBefore" ]; then echo "error"; return; fi
  # The drain controller's own classification is the outcome — never re-derive it here. Under the
  # redecompose regime (2026-08-13) a bounded arm ALSO counts as arm-success when the run was PRODUCTIVE
  # (completions, or the designed redecompose detour materializing children): the strict every-card-completed
  # bar structurally failed both arms inside any preset ceiling (6/6 concordant fails at 45 AND 90 minutes)
  # and carried zero McNemar information.
  outcome="$(python3 -c "
import json,sys
try:
    d=json.load(open('$runDirAfter/drain.json'))
    ok = d.get('classification',{}).get('success') or d.get('progression',{}).get('productive')
    print('true' if ok else 'false')
except Exception:
    print('error')" 2>/dev/null)"
  echo "${outcome:-error}"
}

if [ "$VERDICT_ONLY" = 0 ]; then
  IFS=',' read -r -a PRESET_LIST <<< "$PRESETS"
  for rep in $(seq 1 "$REPEAT"); do
    for preset in "${PRESET_LIST[@]}"; do
      echo "── pair: preset=$preset rep=$rep ── arm A ($FLAG off)…"
      A_OUT="$(run_arm "$preset" "")"
      echo "   arm A: $A_OUT ── arm B ($FLAG=1)…"
      B_OUT="$(run_arm "$preset" "1")"
      echo "   arm B: $B_OUT"
      if [ "$A_OUT" = "error" ] || [ "$B_OUT" = "error" ]; then
        # A pair with a broken arm is NOT a pair — recording it would let infrastructure noise vote.
        echo "   ⚠ pair DISCARDED (an arm errored) — infrastructure noise must not vote" >&2
        continue
      fi
      printf '{"flag":"%s","preset":"%s","rep":%s,"a":%s,"b":%s,"at":"%s"}\n' \
        "$FLAG" "$preset" "$rep" "$A_OUT" "$B_OUT" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >> "$PAIRS_FILE"
    done
  done
fi

echo ""
echo "── VERDICT over all accumulated pairs in $PAIRS_FILE ──"
npx tsx -e "
(async () => {
  const { readFileSync, existsSync } = await import('node:fs');
  const { decideDefaultFlip } = await import('$REPO/src/core/ab-significance-gate.ts');
  if (!existsSync('$PAIRS_FILE')) { console.log('no pairs recorded yet'); return; }
  const pairs = readFileSync('$PAIRS_FILE', 'utf8').trim().split('\n').filter(Boolean)
    .map((line) => JSON.parse(line)).map((row) => ({ a: row.a === true, b: row.b === true }));
  const decision = decideDefaultFlip({ pairs });
  console.log(JSON.stringify({ flag: '$FLAG', pairs: pairs.length, ...decision }, null, 2));
})();
"

#!/bin/zsh
# Overnight batch (David greenlit all three, 2026-08-05): the real-model legs of P23.5, N8 and P25.3.
# SEQUENTIAL on purpose — parallel real-model drains starve each other's turns and false-timeout (§4A).
# Never loads or unloads a model; the resident set stays the operator's.
set -u
cd /Users/david/GIT/nklein
OUT=.real-runs/overnight
mkdir -p "$OUT"
echo "=== overnight batch start $(date '+%H:%M') ==="

# ── Leg 1 (P23.5 positive leg): drain project 02 with a real model, then grade with the HELD-OUT oracle.
echo "--- leg 1: P23.5 positive leg (project 02) ---"
rm -rf "$OUT/p23.5-ws"
npx tsx scripts/real-model-drain.mts \
  --workspace dev-test-projects/02_construction_jobsite_safety_compliance \
  --prompt-file "$OUT/p23.5-prompt.txt" \
  --out "$OUT/p23.5-ws" --max-min 150 > "$OUT/p23.5-drain.log" 2>&1
echo "leg 1 drain exit=$? (log $OUT/p23.5-drain.log)"
npx tsx -e "
import { runHeldOutOracle } from './src/core/held-out-oracle-runner';
import { resolve } from 'node:path';
(async () => {
  const v = await runHeldOutOracle({
    workspacePath: resolve('$OUT/p23.5-ws'),
    probeDir: resolve('test/protected/oracle/02_construction_jobsite_safety_compliance'),
    repoRoot: process.cwd(),
  });
  console.log('independent:', v.independence.independent);
  for (const r of v.results) console.log(' ', r.probe.id, r.passed ? 'PASS' : 'fail');
  console.log('ORACLE:', v.failToPassPassed + '/' + v.failToPassTotal, 'delivered:', v.delivered);
})().catch(e => { console.error(String(e)); process.exit(1); });
" > "$OUT/p23.5-oracle.log" 2>&1
echo "leg 1 oracle: $(grep -E '^ORACLE:' "$OUT/p23.5-oracle.log" || echo 'see log')"

# ── Leg 2 (N8): a real model attempts a pinned SWE-bench instance; the SEALED grader judges it.
echo "--- leg 2: N8 real-model SWE-bench attempt (pallets__flask-5014) ---"
rm -rf "$OUT/n8-ws"
npx tsx -e "
import { materializeSwebenchInstance, swebenchCacheRoot } from './src/core/swebench-materialize';
import { writeFileSync } from 'node:fs';
(async () => {
  const m = await materializeSwebenchInstance({ cacheRoot: swebenchCacheRoot(process.cwd()), instanceId: 'pallets__flask-5014', targetDir: '$OUT/n8-ws' });
  const { buildSwebenchCard } = await import('./src/core/swebench-instance');
  writeFileSync('$OUT/n8-prompt.txt', buildSwebenchCard(m.instance).prompt);
  console.log('materialized + prompt written');
})().catch(e => { console.error(String(e)); process.exit(1); });
" > "$OUT/n8-setup.log" 2>&1
echo "leg 2 setup exit=$?"
npx tsx scripts/real-model-drain.mts \
  --workspace "$OUT/n8-ws" --prompt-file "$OUT/n8-prompt.txt" \
  --out "$OUT/n8-ws-drained" --max-min 90 > "$OUT/n8-drain.log" 2>&1
echo "leg 2 drain exit=$? (log $OUT/n8-drain.log)"
npx tsx scripts/swebench-grade.mts grade pallets__flask-5014 "$OUT/n8-ws-drained" > "$OUT/n8-grade.log" 2>&1
echo "leg 2 grade: $(cat "$OUT/n8-grade.log" | tail -1)"

# ── Leg 3 (P25.3 depth rows): a proven-preset drain purely to populate depth-matched fitness evidence.
echo "--- leg 3: P25.3 depth rows (mid_task, proven runner) ---"
scripts/real-model-run.sh mid_task --act --max-min 60 > "$OUT/p25.3-run.log" 2>&1
echo "leg 3 exit=$? (log $OUT/p25.3-run.log)"

echo "=== overnight batch done $(date '+%H:%M') ==="

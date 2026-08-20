#!/usr/bin/env bash
# scripts/effort-ab.sh — the qwen3.8 reasoning-effort A/B: template default 'xhigh' (arm A, the shipped
# default) vs 'medium' (arm B, the community-favored no-injection mode).
#
# WHY THE ARM SWITCH IS A TEMPLATE EDIT: on this artifact (lmstudio-community/Qwen3.8-27B-MLX-8bit, raw HF
# download, no model.yaml) LM Studio VALIDATES the OpenAI `reasoning_effort` field but silently drops it
# before the chat template — verified 2026-08-20: template-invalid 'high' does not raise, 'none' does not
# disable thinking, chat_template_kwargs is dead too. The template's `default('xhigh')` is therefore the
# only lever, and it means every prior run carried the xhigh overthink instruction.
#
# DESIGN (pre-registered):
#   · PRIMARY metric: per-attempt duration + reasoning-token share (continuous, dozens of samples/arm).
#     Delivery/verdict rates are GUARD metrics only — dev experiment-design shows 2×2×2 is underpowered
#     by construction for rate deltas (<~72pp undetectable); reporting them as a verdict would be dishonest.
#   · ABBA blocks (P20.7) against m5max thermal ordering: A-block, B-block, B-block, A-block.
#   · Both arms run FRESH on the same HEAD — the banked xhigh history predates this session's reviewer
#     fixes, so it is a different product and NOT a valid arm.
#   · Arm verification is post-hoc per run from the LM Studio devlog's RENDERED prompt: arm A must show
#     "Reasoning effort is set to xhigh", arm B must show zero occurrences of "Reasoning effort is set to".
#   · Sequential drains only; the model is UNLOADED before every arm flip so the template re-reads at
#     admission regardless of when LM Studio snapshots it.
#   · Every run appends one row to a durable campaign ledger; the extractor aggregates across invocations.
#
# Usage: scripts/effort-ab.sh [--presets p1,p2] [--max-min M] [--blocks N]
#   --blocks N: number of ABBA half-cycles (default 2 ⇒ A B B A over the preset list).
set -uo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
MODEL_DIR="$HOME/.lmstudio/models/lmstudio-community/Qwen3.8-27B-MLX-8bit"
MODEL_ID="qwen3.8-27b-mlx"
CAMPAIGN_DIR="$HOME/nklein-ab-campaigns"
LEDGER="$CAMPAIGN_DIR/qwen38-effort.jsonl"
PRESETS="mid_task,deep_chain"; MAX_MIN=30; BLOCKS=2

while [ "$#" -gt 0 ]; do
  case "$1" in
    --presets) PRESETS="$2"; shift 2;;
    --max-min) MAX_MIN="$2"; shift 2;;
    --blocks) BLOCKS="$2"; shift 2;;
    *) echo "error: unknown option $1" >&2; exit 64;;
  esac
done

[ -d "$MODEL_DIR" ] || { echo "error: model dir not found: $MODEL_DIR" >&2; exit 66; }
mkdir -p "$CAMPAIGN_DIR"

# ── GPU guards: never contend with a live drain (§4A sequential-drains rule). ──────────────────────────
if pgrep -f "scripts/real-model-run.sh" >/dev/null 2>&1; then
  echo "error: a real-model-run drain is live; refusing to start (sequential drains only)" >&2; exit 75
fi
if lsof -ti :3484 >/dev/null 2>&1; then
  echo "error: port 3484 is busy (a runtime is up); refusing to start" >&2; exit 75
fi

# ── Template flip machinery. Byte-exact backups once; EXIT trap restores the shipped xhigh default. ───
for f in chat_template.jinja tokenizer_config.json; do
  [ -f "$MODEL_DIR/$f.ab-backup" ] || cp "$MODEL_DIR/$f" "$MODEL_DIR/$f.ab-backup"
done
restore_shipped() {
  for f in chat_template.jinja tokenizer_config.json; do
    cp "$MODEL_DIR/$f.ab-backup" "$MODEL_DIR/$f"
  done
  echo "[effort-ab] template restored to shipped default (xhigh)"
}
trap restore_shipped EXIT

flip_to() { # $1 = xhigh | medium — rewrites BOTH template copies (they ship byte-identical; keep them so).
  local target="$1"
  python3 - "$MODEL_DIR" "$target" <<'PYEOF'
import re, sys
model_dir, target = sys.argv[1], sys.argv[2]
for name in ("chat_template.jinja", "tokenizer_config.json"):
    p = f"{model_dir}/{name}"
    s = open(p).read()
    out = re.sub(r"default\('(?:xhigh|medium)'\)", f"default('{target}')", s)
    assert f"default('{target}')" in out, f"flip failed for {name}"
    open(p, "w").write(out)
print(f"[effort-ab] template default -> {target}")
PYEOF
}

# LM Studio snapshots the chat template at LOAD time (probed 2026-08-20: an on-disk flip does not change a
# loaded instance's rendered prompt), so every flip requires a fresh load — and the fresh load needs the
# WHOLE machine: with another 262k-context resident holding its KV reservation, admission overdraws by
# ~41 GiB and FATALs. Single-model rig ⇒ unloading everything is correct, and the rig re-admits its model.
unload_model() { lms unload --all >/dev/null 2>&1 || true; }

run_arm() { # $1 = arm (A|B), $2 = effort (xhigh|medium), $3 = preset
  local arm="$1" effort="$2" preset="$3"
  flip_to "$effort"
  unload_model  # the rig re-admits at launch, reading the flipped template fresh
  echo "[effort-ab] arm=$arm effort=$effort preset=$preset (max ${MAX_MIN}m)"
  local out
  # Single-model rig: every role (incl. the child worker, whose default is the un-admittable coder-14b —
  # the run-0 FATAL) runs the flipped model, so the arm is the ONLY variable.
  out="$(NKLEIN_CHILD_WORKER_MODEL="$MODEL_ID" "$REPO/scripts/real-model-run.sh" "$preset" --act --worker "$MODEL_ID" --max-min "$MAX_MIN" 2>&1 | tail -20)"
  local run_dir
  run_dir="$(printf '%s\n' "$out" | grep -oE '/[^ ]*\.real-runs/[0-9-]+' | tail -1)"
  # Post-hoc arm verification from the devlog's rendered prompts — a flip that did not take must be LOUD.
  local xhigh_hits=0 any_hits=0 prompts_seen=0
  if [ -n "$run_dir" ] && [ -f "$run_dir/lmstudio-devlog.txt" ]; then
    xhigh_hits="$(grep -c "Reasoning effort is set to xhigh" "$run_dir/lmstudio-devlog.txt" || true)"
    any_hits="$(grep -c "Reasoning effort is set to" "$run_dir/lmstudio-devlog.txt" || true)"
    prompts_seen="$(grep -c "im_start" "$run_dir/lmstudio-devlog.txt" || true)"
  fi
  local arm_verified=false
  if [ "$effort" = "xhigh" ] && [ "${xhigh_hits:-0}" -gt 0 ]; then arm_verified=true; fi
  # medium: zero effort-instruction lines is only meaningful if rendered prompts were captured at all —
  # an empty devlog would "verify" every arm (green-signal substitution).
  if [ "$effort" = "medium" ] && [ "${any_hits:-0}" -eq 0 ] && [ "${prompts_seen:-0}" -gt 0 ]; then arm_verified=true; fi
  printf '{"recordedAt":"%s","arm":"%s","effort":"%s","preset":"%s","runDir":"%s","armVerified":%s,"xhighHits":%s,"anyEffortHits":%s}\n' \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$arm" "$effort" "$preset" "${run_dir:-}" "$arm_verified" "${xhigh_hits:-0}" "${any_hits:-0}" >> "$LEDGER"
  if [ "$arm_verified" != "true" ]; then
    echo "[effort-ab] ARM VERIFICATION FAILED (effort=$effort xhigh_hits=$xhigh_hits any=$any_hits run=$run_dir) — aborting campaign" >&2
    exit 70
  fi
}

# ── ABBA blocks over the preset list. ─────────────────────────────────────────────────────────────────
IFS=',' read -r -a PRESET_ARR <<< "$PRESETS"
for ((block=0; block<BLOCKS; block++)); do
  if [ $((block % 2)) -eq 0 ]; then FIRST=xhigh; SECOND=medium; else FIRST=medium; SECOND=xhigh; fi
  for preset in "${PRESET_ARR[@]}"; do
    run_arm "$([ "$FIRST" = xhigh ] && echo A || echo B)" "$FIRST" "$preset"
  done
  for preset in "${PRESET_ARR[@]}"; do
    run_arm "$([ "$SECOND" = xhigh ] && echo A || echo B)" "$SECOND" "$preset"
  done
done

echo "[effort-ab] campaign block(s) complete — ledger: $LEDGER"
echo "[effort-ab] extract metrics: npx tsx scripts/effort-ab-metrics.mts"

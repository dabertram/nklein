// §5.U data/logic split (2026-07-07): the curated model-capability catalog DATA table, lifted out of
// `model-capability-catalog.ts` so that module stays logic-focused (lookup / suitability / roster). This file is
// PURE DATA — a single `readonly ModelCapabilityEntry[]` literal, no logic. The type lives in the sibling module;
// importing it here is type-only (erased at runtime), so there is no runtime import cycle (logic -> data only).

import type { ModelCapabilityEntry } from "./model-capability-catalog.js";

/**
 * The curated catalog. ORDER MATTERS: {@link lookupModelCapability} returns the first entry whose `match`
 * hits, so list the most specific patterns first (e.g. `phi-4-mini-reasoning` before `phi-4-mini`, `e4b`
 * before a generic `gemma-4`). Seeded 2026-06-29 from the §5.AL research sweep + our own model sweeps.
 */
export const MODEL_CAPABILITY_CATALOG: readonly ModelCapabilityEntry[] = [
	// ── Reasoning-only Phi variants: the classic trap — NOT trained for tool use ──────────────────────────
	{
		family: "phi-4-mini-reasoning",
		match: /phi-?4-mini-reasoning/,
		toolUse: "TOOL_UNSUITABLE",
		kind: "reasoning",
		note: 'Math-reasoning-only; the card states it is "designed and tested for math reasoning only" and never mentions tool use. Use phi-4-mini-instruct instead for tool chains. EVAL-HARNESS FLEET SWEEP (§5.AB, 2026-07-08, 8-model roster): the PHI-FLIP question answered LIVE — under native tool_call it did NOT flip: decompose 0/3 NO ANSWER (never emits the structured call), so only reviewer/review scored (mean 0.667 over 3 cells). Confirms TOOL_UNSUITABLE for structured/agentic roles; its instruct sibling excels. basis: empirical.',
		sources: ["https://huggingface.co/microsoft/Phi-4-mini-reasoning"],
		basis: "research",
		verified: true,
	},
	{
		family: "phi-4-reasoning-plus",
		match: /phi-?4-reasoning(-plus)?/,
		toolUse: "TOOL_UNSUITABLE",
		kind: "reasoning",
		note: 'Pure chain-of-thought reasoning model. Microsoft staff: "Function calling is only supported on Phi-4-mini-based models." No tool format in the chat template. EVAL-HARNESS FLEET SWEEP (§5.AB, 2026-07-08): high quality WHERE it answered (mean 0.875) but only 4/6 cells scored (decompose partial via native tool_call) AND a severe LATENCY outlier — 334s, the slowest of the 8-model roster by far. Quality without throughput; unsuitable for latency-sensitive roles. basis: empirical.',
		sources: ["https://huggingface.co/microsoft/Phi-4-reasoning-plus/discussions/13"],
		basis: "research",
		verified: true,
	},
	{
		family: "phi-4-mini-instruct",
		match: /phi-?4-mini(-instruct)?/,
		toolUse: "TOOL_CAPABLE",
		kind: "instruct",
		chaining: "native",
		synthesis: "weak",
		speed: "fast",
		sizeGb: 2.5,
		note: 'The only Phi-4 variant trained for function calling (<|tool|> JSON). Fragile in practice — parser bugs across frameworks and the card admits it "could sometimes hallucinate function names". Our sweeps: ◑ with the constrained rung. 2026-07-01 (model-lab guarded e2e, phi-4-mini-instruct@4bit): drove ALL 4 tools + PERSISTED the card, WEAK synthesis (no marker echo), VERY fast (~5s) — the full chain fired natively in this harness (the §5.AB force-advance wiring appears to carry it). Notable as a ~2B-class model clearing the multi-tool chain; kept TOOL_CAPABLE (chain ✓, synth weak). Re-run to confirm stability given its known fragility. EVAL-HARNESS FLEET SWEEP (§5.AB, 2026-07-08, 8-model roster @8bit): the EFFICIENCY WINNER — mean 0.917 over all 6 cells in just 62s (architect/decompose 3/3 via json_schema, fast 2-3s/cell; reviewer strong). Best quality×speed of the whole roster — a 3.8B non-reasoning model tying the top score at a fraction of the latency. Strongly confirms TOOL_CAPABLE + fast; a top pick for latency-sensitive structured roles. ⭐ HIGH-POWER REFRESH (§11 sweep 2026-07-11, @8bit, 12 cells): mean 0.958 — TIES nemotron-3-super for the HIGHEST of the whole sweep, at 3.8B and ~1min TOTAL eval (2s/decompose, sub-second tool-use = the FASTEST high-quality model). Decompose 1.0 all tiers + worker 1.0, and — the key one — REVIEWER 0.833 with the HARD race/leak/injection trio CAUGHT. That is decisive for the reviewer story: phi-4-mini-instruct is a PLAIN INSTRUCT (non-reasoning) 3.8B, yet it out-reviews every 7-14B qwen instruct/coder (all ~0.55-0.72). So strong review recall is MODEL-SPECIFIC, not cleanly reasoning-depth- or size-gated — the qwen instruct/coder family specifically under-catches the hard trio. → phi-4-mini-instruct@8bit is arguably the BEST all-round small pick: top quality, catches the hard review trio, and the fastest. basis: empirical.',
		sources: [
			"https://huggingface.co/microsoft/Phi-4-mini-instruct",
			"live chat-agent e2e 2026-07-01 (scripts/verify-chat-agent-e2e.mts, model-lab guarded sweep — phi-4-mini-instruct@4bit: all 4 tools + persist, weak synth, ~5s)",
		],
		basis: "both",
		verified: true,
	},
	// ── Gemma: chat/instruct families, tool use only via prompt-engineering (no tool tokens) ───────────────
	{
		family: "gemma-4-e4b",
		match: /gemma-?4[-_]?e4b/,
		toolUse: "TOOL_WEAK",
		kind: "instruct",
		note: "Gemma 4 edge E4B (4B). Vendor docs advertise native structured tool use ('more reliable than E2B'), but live 2026-06-29 (HIGH power, fresh-loaded, e2e ×3) it FAILED the multi-tool chain 3/3 — used read_file then dropped the chain (no run_command/create_card/focus-chain), card never persisted. So the vendor claim does NOT hold at 4B in our harness: single-tool only, fails chaining (the ≤4B floor). Verdict corrected research→empirical. CONTRADICTION 2026-07-01 (model-lab guarded e2e, post force-advance-fix): this run it drove ALL 4 tools + PERSISTED the card (weak synthesis, ~37s) — i.e. it CHAINED, opposite of the 3/3 fail above. One run under a changed harness (the §5.AB force-advance wiring now carries most models through the chain), so the verdict is held at TOOL_WEAK for now; owed: ×3 re-run to confirm before lifting the verdict.",
		sources: [
			"https://ai.google.dev/gemma/docs/capabilities/text/function-calling-gemma4",
			"live chat-agent e2e 2026-07-01 (scripts/verify-chat-agent-e2e.mts, model-lab guarded sweep — ALL 4 tools + persist, weak synth; contradicts the 2026-06-29 3/3 fail)",
		],
		basis: "both",
		verified: true,
	},
	{
		family: "gemma-4-e2b",
		match: /gemma-?4[-_]?e2b/,
		toolUse: "TOOL_WEAK",
		kind: "instruct",
		note: "Gemma 4 edge E2B (2B). Below our empirical multi-tool chaining floor — live-confirmed 2026-06-29 (HIGH power, fresh-loaded, e2e ×2): used read_file then dropped the chain 2/2, card never persisted. Single-tool calls only (the ≤4B floor).",
		sources: ["https://ai.google.dev/gemma/docs/capabilities/text/function-calling-gemma4"],
		basis: "both",
		verified: true,
	},
	{
		// Gemma 4 26B-A4B MoE (qat) — a DISTINCT, far more capable Gemma-4 than the ≤4B edge variants above. Its regex
		// (`26b`) can't hit e4b/e2b and vice-versa, so order among the gemma-4 rows is not load-bearing; kept in the family
		// block before the generic gemma-3/gemma-2 rows. NOT previously in the catalog.
		family: "gemma-4-26b",
		match: /gemma-?4[-_]?26b/,
		toolUse: "TOOL_CAPABLE",
		kind: "instruct",
		chaining: "native",
		synthesis: "weak",
		speed: "fast",
		sizeGb: 15,
		note: "Gemma 4 26B-A4B-qat (26B MoE, ~4B active, quantization-aware-trained). NEW to the catalog. Live 2026-07-01 model-lab guarded e2e: drove ALL 4 tools (read_file+run_command+create_card+update_focus_chain) + PERSISTED the card — NATIVELY, no force rung — with WEAK synthesis (final reply didn't echo the marker), fast (~34s). FAR stronger multi-tool chaining than its e4b/e2b EDGE siblings (which fail the chain at ≤4B) — the MoE 26B clears the chaining floor comfortably. structuredOutput not probed (omitted — left honest). Verdict TOOL_CAPABLE (chain ✓; only synthesis is weak).",
		sources: [
			"live chat-agent e2e 2026-07-01 (scripts/verify-chat-agent-e2e.mts, model-lab guarded sweep — google/gemma-4-26b-a4b-qat: all 4 tools + persist, weak synth, ~34s); see docs/dev/model-sweep-log.md",
		],
		basis: "empirical",
		verified: true,
	},
	{
		// Gemma 4 12B-it-qat — a capable mid Gemma-4 (dense); its `12b` regex can't hit e4b/e2b/26b, so order among the
		// gemma-4 rows is not load-bearing; kept in the family block before the generic gemma-3/gemma-2 rows.
		family: "gemma-4-12b",
		match: /gemma-?4[-_]?12b/,
		toolUse: "TOOL_CAPABLE",
		kind: "instruct",
		chaining: "native",
		synthesis: "full",
		speed: "fast",
		sizeGb: 7,
		note: "gemma-4-12b-it-qat (12B, quantization-aware-trained). Live e2e 2026-07-01 (model-lab guarded sweep, ON THE LAPTOP 8 GB-VRAM box): CLEAN PASS (~21s) — drove ALL 4 tools + PERSISTED the card + echoed the marker = FULL synthesis. Here even cleaner than the 26B-A4B sibling (which had weak synth), and far above the e2b/e4b EDGE variants (which drop the chain). A capable small all-rounder that runs FAST even on the laptop's discrete 8 GB GPU.",
		sources: [
			"live chat-agent e2e 2026-07-01 (scripts/verify-chat-agent-e2e.mts, model-lab guarded sweep on laptop — gemma-4-12b-it-qat CLEAN PASS, ~21s, full synth); see docs/dev/model-sweep-log.md",
		],
		basis: "empirical",
		verified: true,
	},
	{
		family: "gemma-3",
		match: /gemma-?3/,
		toolUse: "TOOL_WEAK",
		kind: "chat",
		note: 'Function calling documented but "exclusively through prompt engineering" — no dedicated tool tokens; reliability hinges entirely on the parsing scaffold.',
		sources: ["https://www.philschmid.de/gemma-function-calling"],
		basis: "research",
		verified: true,
	},
	{
		family: "gemma-2",
		match: /gemma-?2/,
		toolUse: "TOOL_WEAK",
		kind: "chat",
		note: "No native function calling and no tool tokens; tool use only via prompt engineering or third-party fine-tunes. Pure chat/instruct model.",
		sources: ["https://simonwillison.net/2025/Mar/26/function-calling-with-gemma/"],
		basis: "research",
		verified: true,
	},
	// ── NVIDIA Nemotron ───────────────────────────────────────────────────────────────────────────────────
	{
		family: "nemotron-mini",
		match: /nemotron-mini/,
		toolUse: "TOOL_CAPABLE",
		kind: "roleplay",
		note: "Tool-call template on paper, but a roleplay/game-character model (NVIDIA ACE) with only 4k context — below our 32k floor — so it is a reject for agentic use despite the on-paper support.",
		sources: ["https://huggingface.co/nvidia/Nemotron-Mini-4B-Instruct"],
		severityOverride: "reject",
		disqualifiers: ["4k context is below the 32k agentic floor", "roleplay-tuned, not agentic"],
		basis: "research",
		verified: true,
	},
	{
		// Matches the Nano line across generations: `nemotron-nano`, `nemotron-3-nano`, `llama-3.1-nemotron-nano`, …
		family: "nemotron-nano",
		match: /nemotron(-\d+)?-nano/,
		toolUse: "TOOL_WEAK",
		kind: "reasoning",
		chaining: "single_only",
		speed: "fast",
		sizeGb: 2.8,
		note: "SFT+RL post-trained for tool calling with a parser + 128k context, BUT user reports show the 4B emitting tool calls as plain text and failing once multiple tools are present (NIM + Ollama). Live-confirmed 2026-06-29 on nvidia/nemotron-3-nano-4b via the chat-agent e2e: it used read_file then DROPPED the chain (no run_command/create_card/focus-chain) — single-tool only, fails multi-tool chaining (consistent with the ≤4B floor). RECONFIRMED 2026-07-01 (model-lab guarded sweep, exit 0 but SINGLE-TOOL only): again used read_file then dropped the chain — the ONLY tested model that did NOT chain even under the §5.AB force-advance wiring that carried the others through. It echoed the marker yet FALSELY claimed all 4 steps were done (narration, not execution). TOOL_WEAK, chaining single_only firmly stands; fast (~54s). ⭐ EVAL-HARNESS STANDOUT (§11 sweep 2026-07-11, m5max HIGH power, mean 0.875/12, ~90s WHOLE eval = FASTEST): the SINGLE-STRUCTURED-CALL roles (decompose/review — NOT the multi-tool chain it fails) are STRONG — DECOMPOSE 1.000 all 3 tiers, and — the surprise — REVIEWER 0.833 with the HARD race/leak/injection trio CAUGHT (1.0), matching the 35B a3b + qwq-32b and BEATING every 7-9B qwen/coder/ornith/qwable (all 0.667 on that hard trio). So the small-model 'reviewer ceiling' is TRAINING-gated, not size-gated: NVIDIA's reasoning-RL lets a 4B out-review 9B qwen-family models. A viable FAST reviewer (~10s/review cell vs the 35B's ~25s, qwq's ~168s) FOR THE SINGLE-CALL review role — just never route MULTI-tool worker chains to it. CORRECTION: the worker context-probe-8k 0.000 was a HARNESS BUG, not a model gap — it answered the passphrase correctly but with NON-BREAKING hyphens (U+2011), which the exact-substring scorer missed (fixed 2026-07-11: scoreContextProbeAnswer now canonicalizes separators). With the fix its worker is 1.0 (6/6) and its true mean is ~0.958 — so nemotron-nano-4b is TOP-TIER (ties phi-4-mini-instruct + nemotron-super), a fast tiny 4B that decomposes 1.0, reviews 0.833 (hard trio), and does single-tool worker/context perfectly. basis: empirical.",
		sources: [
			"https://community.n8n.io/t/nvidia-llama-3-1-nemotron-nano-4b-v1-1-tool-calling-issue/135282",
			"live chat-agent e2e 2026-07-01 (scripts/verify-chat-agent-e2e.mts, model-lab guarded sweep — nemotron-3-nano-4b: single-tool only, dropped the chain, false 'all steps done')",
			"eval-harness 2026-07-11 (m5max HIGH power, nemotron-3-nano-4b: mean 0.875/12 — decompose 1.0, REVIEWER 0.833 incl. the hard trio, ~90s total = fastest; worker context-8k 0.000 glitch); see docs/dev/model-sweep-log.md",
		],
		basis: "both",
		verified: true,
	},
	{
		// nemotron-3-super — the big NVIDIA reasoning model (matched by the distinct `super` token; no nano collision).
		family: "nemotron-super",
		match: /nemotron(-\d+)?-super/,
		toolUse: "TOOL_CAPABLE",
		kind: "reasoning",
		speed: "medium",
		sizeGb: 86,
		note: "nvidia/nemotron-3-super (~86 GB). §11 sweep 2026-07-11 (m5max HIGH power, eval-harness native_tool_call): the HIGHEST mean of the whole sweep — 0.958/12, ALL cells scored (no over-think NO-ANSWERs). Decompose 1.000 all 3 tiers + worker/tool-use + context probes 1.000; REVIEWER 0.833 (caught the hard race/leak/injection trio). This CONFIRMS the nemotron-reviews-well pattern AT SCALE: both nemotron-3-nano-4b (0.833) and this super (0.833) catch the hard trio, so strong review recall is a NEMOTRON reasoning-RL family trait (robust 4B→super), unlike the qwen-family ~0.72 ceiling — the reviewer weakness is TRAINING-gated, not size-gated. Efficient for its size (whole eval ~6min, faster than the 35B qwq's ~22min). CAVEAT: at ~86 GB it leaves only ~42 GB free on the 128 GB box (near the 25% reserve) and can't coexist with other residents — impractical as a routine reviewer vs the tiny nemotron-nano-4b (same 0.833 review, 2.8 GB); reserve it for a dedicated big-box architect/reviewer. basis: empirical.",
		sources: [
			"eval-harness 2026-07-11 (m5max HIGH power, nvidia/nemotron-3-super: mean 0.958/12 — decompose 1.0, worker 1.0, reviewer 0.833, all cells scored, ~6min); see docs/dev/model-sweep-log.md",
			"chat-agent-tools 2026-07-11 (single-read PASS, call+synth)",
		],
		basis: "empirical",
		verified: true,
	},
	// ── DeepSeek R1 distill (matched BEFORE Qwen: its id contains "qwen3-8b" but it's a reasoning distill) ──
	{
		family: "deepseek-r1-distill",
		match: /deepseek-r1.*qwen3?-8b|deepseek-r1-0528/,
		toolUse: "TOOL_WEAK",
		kind: "reasoning",
		note: 'Reasoning distill: card claims "enhanced function calling" but ships no parser/template; calls leak into content and </think> tags break parsers. Poor fit for unattended tool chaining. SWEEP-CONFIRMED (§11 2026-07-11, HIGH power, eval-harness mean 0.867/10): DECOMPOSE is FLAKY — 2 of 3 architect cells NO ANSWER (easy+medium; only hard landed), i.e. it over-thinks / leaks the structured decompose call — while every OTHER reasoning model swept (qwq-32b, qwen3.6-35b-a3b, nemotron) decomposed 1.0, so "reasoning flakes on tool-call" is R1-SPECIFIC, not a reasoning-family trait. Reviewer weak (0.556 — medium 0.000, hard 0.667). Worker single-tool/context is fine (1.0) WHEN it emits. So: avoid r1 for decompose/review; its distill-specific call-leakage is the culprit. basis: both.',
		sources: [
			"https://github.com/vllm-project/vllm/issues/19001",
			"eval-harness 2026-07-11 (m5max HIGH power, deepseek-r1-0528-qwen3-8b: mean 0.867/10 — decompose 2/3 NO-ANSWER flaky, reviewer 0.556, worker 1.0); see docs/dev/model-sweep-log.md",
		],
		basis: "both",
		verified: true,
	},
	{
		// GLM-4.x flash (Zhipu/zai). Its `glm-4` token can't collide with the qwen/gemma/phi rows.
		family: "glm-4-flash",
		match: /glm-4[._-]?\d*[._-]?flash|zai-org\/glm-4/,
		toolUse: "TOOL_WEAK",
		kind: "instruct",
		note: "GLM-4.7-flash (zai-org, ~32B). §11 sweep 2026-07-11 (m5max HIGH power, chat-agent-tools single-read probe): did NOT emit a tool call at all (FAIL/no-call) — the agent got no read_file. GLM-4 uses a DISTINCT tool-call format/template; via LM Studio's OpenAI `/v1` our parser saw no structured call, so this is most likely a DIALECT/parser mismatch rather than a proven capability gap (same class as the deepseek-r1 'calls leak into content' issue). Verdict TOOL_WEAK pending a GLM-dialect-aware probe (native `/api/v0` or a GLM tool template); do NOT route unattended tool work here until the format is verified. n=1. basis: empirical.",
		sources: [
			"live chat-agent-tools 2026-07-11 (m5max, `zai-org/glm-4.7-flash` — no tool call emitted; §11 sweep, likely dialect mismatch)",
		],
		basis: "empirical",
		verified: false,
	},
	// ── Ornith (local MLX) ────────────────────────────────────────────────────────────────────────────────
	{
		// Ornith-1.0 = DeepReinforce's SELF-SCAFFOLDING agentic CODING family (2026-06, MIT): RL-learns to jointly produce the
		// solution AND its OWN scaffold (plan/tool-calls/error-recovery). The 35B MoE (~3B active) BEATS Qwen-3.5-397B on
		// Terminal-Bench 2.1 → top-tier agentic coder ON PAPER. Our LOCAL @4bit/@8bit MLX checkpoints load-fail (see note) so
		// this verdict is RESEARCH-based, not yet verified by us. Size-anchored to 35b (won't touch the healthy 9B sibling).
		family: "ornith-1.0-35b",
		match: /ornith-?1(\.0)?-35b/,
		toolUse: "TOOL_CAPABLE",
		kind: "code",
		selfScaffolding: true,
		note: "Ornith-1.0-35B MoE (DeepReinforce, 2026-06, MIT) — a SELF-SCAFFOLDING agentic CODING model: it RL-learns to jointly produce the solution AND its OWN scaffold (task plan / tool calls / error recovery); at inference it PROPOSES a refined scaffold, then solves. Research-STRONG: the 35B MoE (~3B active/token) beats Qwen-3.5-397B on Terminal-Bench 2.1 (64.2 vs 53.5) — top-tier agentic coder on paper. ⚠ NOT verified by us — our LOCAL MLX checkpoints (`@4bit` AND `@8bit`) LOAD-FAIL (`lms load` exits 1 at ~2%, 3/3, 2026-07-01: a broken/incompatible QUANT CONVERSION, NOT headroom/guard). LOAD FIX: use the official `leonsarmiento/Ornith-1.0-35B-5bit-mlx` (mixed 5/8-bit) OR the GGUF/FP8/bf16 weights (`deepreinforce-ai/Ornith-1.0-35B`) — not the @4bit/@8bit MLX. ⚠ HANDLING (§5.AB-E): it SELF-SCAFFOLDS, so !Klein's force-advance + aggressive decomposition may CONFLICT with its own orchestration — let it author its own workflow (decompose LESS; give it room/budget to plan first; may need a warm-up turn to author the scaffold). Corrected from a WRONG TOOL_UNSUITABLE+reject (that conflated a load-fail with incapability — user caught it 2026-07-01; the 9B sibling loads + passed C0/C1/C2).",
		sources: [
			"deep-reinforce.com/ornith_1_0.html; marktechpost.com/2026/06/25 Ornith-1.0 release; huggingface.co/deepreinforce-ai/Ornith-1.0-35B; huggingface.co/leonsarmiento/Ornith-1.0-35B-5bit-mlx (official MLX)",
			"live model-lab sweep 2026-07-01: the @4bit/@8bit MLX checkpoints load-fail 3/3 (docs/dev/model-sweep-log.md) — a CHECKPOINT issue, not a capability verdict",
		],
		basis: "both",
		verified: false,
	},
	{
		// Ornith-1.0-9B — the 9B sibling of the 35B self-scaffolding coder. Its `9b` token can't hit the `-35b` row.
		family: "ornith-1.0-9b",
		match: /ornith-?(1[._]0-)?9b|ornith-9b/,
		toolUse: "TOOL_CAPABLE",
		kind: "code",
		chaining: "native",
		synthesis: "full",
		speed: "fast",
		sizeGb: 5.6,
		note: "Ornith-1.0-9B (DeepReinforce self-scaffolding agentic coder, the 9B sibling of the 35B — and unlike the 35B it LOADS fine, e.g. `ornith-1.0-9b@q4_k_m`). §11 sweep 2026-07-11 (m5max HIGH power, eval-harness native_tool_call, mean 0.931/12): DECOMPOSE PERFECT 1.000 all 3 tiers + worker/tool-use + context probes 1.000; reviewer 0.722 (the small-model ceiling). STANDOUT: FAST + reliable — ~8-13s per decompose cell, the WHOLE 12-cell eval in ~3 MINUTES (vs qwable-9b ~19min, qwq-32b ~22min), and it scored every cell (no over-think NO-ANSWERs). So the 9B ornith is a FAST, reliable decompose+worker all-rounder (ties qwen3-8b/qwable-9b at 0.931 quality but among the FASTEST) — a strong local worker/architect pick, weak only as a reviewer. Also chat-agent-tools single-tool PASS. NOTE the 35B sibling's self-scaffolding caveat may apply (give it room to plan), though the 9B chained cleanly in-harness. basis: empirical.",
		sources: [
			"eval-harness 2026-07-11 (m5max HIGH power, ornith-1.0-9b@q4_k_m: mean 0.931/12 — decompose 1.0 all tiers, worker 1.0, reviewer 0.722, ~3min total = FAST); see docs/dev/model-sweep-log.md",
			"chat-agent-tools 2026-07-11 (single-read PASS, call+synth)",
		],
		basis: "empirical",
		verified: true,
	},
	// ── Qwen ──────────────────────────────────────────────────────────────────────────────────────────────
	{
		// The qwopus3.6 REASONING lineage (the 27B). MORE SPECIFIC than the generic `qwopus` row below, so it must
		// precede it (else `/qwopus/` shadows this and misreports the reasoning nuance). arch = qwen3.6-lineage reasoner.
		family: "qwopus3.6",
		match: /qwopus-?3[._]6/,
		toolUse: "TOOL_CAPABLE",
		kind: "reasoning",
		chaining: "via_force",
		synthesis: "weak",
		structuredOutput: "native_tool_call",
		speed: "slow",
		sizeGb: 28.6,
		note: "qwopus3.6-27b-v2-mlx (qwen3.6×opus reasoning merge). Completes the full 4-step agentic tool-chain + persists a card — but VIA !Klein's §5.AB force-advance rung (default-on for reasoning on the stuck branch); WITHOUT it it fixates and re-calls the first tool (not a clean native multi-tool chainer). Live 2026-07-01 e2e = PASS/PARTIAL (chain executed + card PERSISTED; the only miss is the final reply not echoing a marker = weak SYNTHESIS, not a capability gap). Per §4A: json_schema structured output dead-ends on it (reasoning-channel conflict) — native tool_choice:required is the working lever. Slow (~28.6 GB resident 27B) — a latency cost for its capability.",
		sources: [
			"live chat-agent e2e 2026-07-01 (scripts/verify-chat-agent-e2e.mts; commits dec62245+89becd66); todo §5.AA/§5.AB force-advance + §4A structured-output-strategy note",
		],
		basis: "empirical",
		verified: true,
	},
	{
		// The qwopus3.5 lineage (arch qwen3_5, CODER-tuned variants). MORE SPECIFIC than the generic `qwopus` below, so it
		// must precede it. Notable: the 4B CODER here OUTPERFORMS the bigger qwopus3.6/qwen3.5 REASONING variants on the
		// agentic chain — coder/instruct tuning beats reasoning-heavy tuning for direct tool use; size is not decisive.
		family: "qwopus3.5-coder",
		match: /qwopus-?3[._]5/,
		toolUse: "TOOL_CAPABLE",
		kind: "code",
		chaining: "native",
		synthesis: "full",
		structuredOutput: "unknown",
		speed: "fast",
		sizeGb: 2.4,
		note: "qwopus3.5 lineage (arch qwen3_5, coder-tuned). The 4B CODER variant (qwopus3.5-4b-coder-fable5-v1-mlx) live 2026-07-01 FULLY PASSED the 4-step agentic chain (exit 0: read_file+run_command+create_card+update_focus_chain, card PERSISTED, AND the reply echoed the marker = full SYNTHESIS) — natively, no force-advance rung needed — notably OUTPERFORMING the bigger qwopus3.6-27b + qwen3.5-9b REASONING variants (only PARTIAL: weak final synthesis). Fast + tiny (~2.4 GB). Lesson: for DIRECT agentic tool use, coder/instruct tuning beats reasoning-heavy tuning — size is NOT the deciding factor. structuredOutput unknown (json_schema vs native not probed on it — left honest). SIZE/VARIANT NUANCE (2026-07-01 model-lab sweep, now verified up): the 9b-coder (@8bit) drove ALL 4 tools + persisted but WEAK synthesis (~67s, medium); mlx-27b-v3 also ALL 4 + persist but WEAK synth AND SLOW (~301s, an MLX 27B latency outlier vs the 26B qat at 34s). So the strong FULL-synth result is specific to the 4B coder — the 9B/27B siblings chain fine but under-summarize; the fields below reflect the 4B (best-in-family). The chaining capability holds across the sizes; only the 4B gets full synthesis. 2026-07-08 (qwopus3.5-9b-coder-mtp, resident): drove decompose_project (7 cards, via §5.AG auto-promote to In Progress); reasoning capture works (§5.O — 197 role:reasoning deltas during thinking); online retrieval synthesis produced a cited answer; and the §5.AD enforced-reasoning bounce turned a naive median() one-liner into a correct comparator-sorted impl (so the 9B CAN reach full-quality output when the bounce loop runs — the weak-synth note is the FIRST-pass behavior). CAVEAT (sweep run 9, 2026-07-08): as a WORKER on a small card the 9b-coder-mtp ran a single generation away for 15+ min (degenerate loop, no tool call, no progress) — with agentTimeoutMode:unlimited there was no wall-clock backstop so it froze the card. Prefer a stronger coder (e.g. qwen2.5-coder-14b) for small worker slots, or gate the 9B behind the runaway-generation detector (runaway-generation-detector.ts). basis: empirical. EVAL-HARNESS FITNESS (§5.AB, 2026-07-08, via native_tool_call): architect/decompose 3/3 = quality 1.000 (landed all via the tool channel — NOT flaky like deepseek-r1, so 'reasoning flakes on tool-call' is r1-specific); reviewer/review quality 0.833 (caught the full toctou/leak/injection trio + partial null-deref) — the STRONGEST all-rounder of the resident roster (mean 0.917 vs coder-14b 0.778, r1-8b 0.667), beating coder-14b on REVIEW while matching on decompose. Slower (hard decompose ~85s). ⚠ QUANT-SENSITIVE (§11 sweep 2026-07-11, HIGH power, `qwopus3.5-9b-coder-mlx@4bit`, REPEATS=1): the strong 0.833 numbers above are the @8bit/mtp settled data — the @4bit quant UNDERPERFORMED in one high-power run: reviewer only 0.722 (hard 0.667 — did NOT catch the full trio, i.e. hit the plain-ceiling not the 0.833) and decompose medium+hard NO ANSWER (only easy landed). Likely a 4bit-quality drop (n=1 so some stochasticity possible), so for the reviewer/decompose roles PREFER the @8bit quant of this model — don't assume the @4bit inherits the @8bit's 0.833 review. basis: empirical.",
		sources: [
			"live chat-agent e2e 2026-07-01 (scripts/verify-chat-agent-e2e.mts, qwopus3.5-4b-coder-fable5-v1-mlx — FULL PASS, exit 0)",
			"live chat-agent e2e 2026-07-01 (scripts/verify-chat-agent-e2e.mts, model-lab guarded sweep — qwopus3.5-9b-coder@8bit + mlx-qwopus3.5-27b-v3: all 4 tools + persist, WEAK synth; 27b-v3 slow ~301s)",
		],
		basis: "empirical",
		verified: true,
	},
	{
		// `qwopus*` = local qwen×opus MERGE fine-tunes (e.g. qwopus3.6-27b-v2-mlx). Match BEFORE the generic qwen rows.
		family: "qwopus-merge",
		match: /qwopus/,
		toolUse: "TOOL_CAPABLE",
		kind: "instruct",
		note: "Local qwen3.6×opus merge fine-tunes (MLX). qwopus3.6-27b-v2-mlx is the capable-model-first driver (user 2026-06-29). Live-verified 2026-06-29: clean single-tool call (finish_reason=tool_calls, correct name+args; reasoning-capable, ~186 reasoning tokens on a trivial call). Multi-tool CHAINING not yet sweep-verified — promote to TOOL_NATIVE once a full e2e chain passes.",
		sources: ["live probe 2026-06-29 (todo §5.AL capable-model-first pivot); see docs/dev/model-sweep-log.md"],
		basis: "empirical",
		verified: true,
	},
	{
		// `qwable*` = local qwen×claude-fable MERGE fine-tunes (David's own tuning; distinct from the qwopus merges).
		family: "qwable-9b",
		match: /qwable-9b|qwable.*fable/,
		toolUse: "TOOL_CAPABLE",
		kind: "instruct",
		chaining: "native",
		synthesis: "full",
		speed: "medium",
		sizeGb: 7,
		note: "qwable-9b-claude-fable-5-mlx (David's local qwen×claude-fable-5 merge, ~7 GB MLX). §11 sweep 2026-07-11 (m5max HIGH power, eval-harness native_tool_call, mean 0.931/12): DECOMPOSE PERFECT 1.000 across all 3 tiers (n=3, no timeouts) + worker/tool-use + context probes 1.000; reviewer 0.722 (easy 1.0, medium 0.5, hard 0.667 — the same small-model reviewer ceiling, misses subtle null/race defects). STANDOUT RELIABILITY: it scored EVERY one of the 12 cells — unlike the bigger reasoning models (qwq-32b, qwen3.6-35b-a3b) which NO-ANSWER'd cells by over-thinking. So David's fable merge is a solid, RELIABLE decompose+worker all-rounder (ties qwen3-8b's 0.931) at 9B, weak only as a reviewer. Also chat-agent-tools single-tool PASS (call+synth). Moderate latency (~57-180s/cell — slower than qwen3-8b but always answers). basis: empirical.",
		sources: [
			"eval-harness 2026-07-11 (m5max HIGH power, qwable-9b-claude-fable-5-mlx: mean 0.931/12 — decompose 1.0 all tiers, worker 1.0, reviewer 0.722, ZERO no-answers); see docs/dev/model-sweep-log.md",
			"chat-agent-tools 2026-07-11 (single-read PASS, call+synth)",
		],
		basis: "empirical",
		verified: true,
	},
	{
		// Specific 7B row first: the Qwen2.5.1-Coder MLX package is a naming/package refresh of the 7B coder line, not an
		// unknown family. Keep it ahead of the generic Qwen2.5-Coder row so packing/advice sees the 7B footprint.
		family: "qwen2.5-coder-7b",
		match: /qwen2[._-]?5(?:[._-]?1)?[._-]?coder[._-]?7b/,
		toolUse: "TOOL_CAPABLE",
		kind: "code",
		chaining: "native",
		synthesis: "full",
		structuredOutput: "json_schema",
		speed: "fast",
		sizeGb: 4.3,
		note: "Qwen2.5 Coder 7B Instruct, including the `qwen2.5.1-coder-7b-instruct` MLX package id. It is the same practical 7B coder family as the prior laptop sweep: native multi-tool chain, full synthesis, fast, and small enough for m4mini worker slots. The 2026-07-09 m4mini guarded load confirmed the MLX 4bit package is resident at ~4.3 GB with 32k context; the live swarm verifier still needs a clean run after the Docker interruption and earlier broken 14B package/template evidence. TOOL-USE UNRELIABLE — TWO 2026-07-11 signals now (m5max, low-power, NON-MLX `qwen2.5-coder-7b-instruct`): (1) chat-agent-tools single-read probe CALLED read_file (audited ✓) but answered \"Done.\" — no synthesis, contradicting the 2026-07-01 MLX-laptop full-synth clean-pass; (2) eval-harness (mean 0.764/12) — architect/decompose PERFECT 1.000 (all 3 tiers, fast ~4.5s, matching coder-14b) BUT worker/tool-use only 0.667 with TWO cells at 0.000 (tooluse-simple-weather + tooluse-multi-select failed outright; irrelevance + all context probes 1.0), and reviewer 0.722 (medium 0.5, hard 0.667). So the picture is: a TOP DECOMPOSER (route architect/decompose here — fast + perfect) but an UNRELIABLE direct-tool-use worker (the 'Done.' abbreviation + the two 0.000 tool cells agree) and a WEAK reviewer. `synthesis: full` now looks OPTIMISTIC on 2 independent low-power signals — held pending a HIGH-power ×3 reconfirm, but do NOT assume reliable tool synthesis from the 7B coder; prefer it for decompose, not for tool-driven worker slots.",
		sources: [
			"https://huggingface.co/Qwen/Qwen2.5-Coder-7B-Instruct",
			"https://huggingface.co/mlx-community/Qwen2.5.1-Coder-7B-Instruct-4bit",
			"live guarded load 2026-07-09 on m4mini (`qwen2.5.1-coder-7b-instruct`, 32k context, ~4.3 GB resident)",
			"live chat-agent e2e 2026-07-01 (model-lab guarded sweep on laptop — qwen2.5-coder-7b-instruct CLEAN PASS, ~18s, full synth)",
			"live chat-agent-tools 2026-07-11 (m5max, `qwen2.5-coder-7b-instruct` ~4.7 GB — called read_file but answered 'Done.', weak synth; §11 sweep increment)",
		],
		basis: "both",
		verified: true,
	},
	{
		family: "qwen2.5-coder",
		match: /qwen2[._-]?5(?:[._-]?1)?[._-]?coder/,
		toolUse: "TOOL_CAPABLE",
		kind: "code",
		chaining: "native",
		synthesis: "weak",
		structuredOutput: "json_schema",
		speed: "fast",
		sizeGb: 8.3,
		note: "Supports tool calling; historically emitted a non-Hermes <tools>/code-block format that failed SILENTLY unless the parser matched. BUT live 2026-06-29 on `qwen/qwen2.5-coder-14b` via LM Studio's OpenAI `/v1`: a single-tool prompt returned a CLEAN STRUCTURED `tool_calls` (`create_card({title})`, finish=tool_calls) AND `response_format json_schema` produced valid structured output — so LM Studio's parser DOES surface its single-tool calls (not silently failing at that grain). Not a reasoning model (reasoning_len 0). The ◑ at 14B caveat is about multi-tool CHAINING, which the constrained rung helps. MULTI-TOOL CHAIN CONFIRMED 2026-07-01 (model-lab guarded e2e, qwen2.5-coder-14b): drove ALL 4 tools + PERSISTED the card this run (chaining native — no visible force rung needed), WEAK synthesis (no marker echo), fast (~45s). So the CHAINING caveat is lifted here; only synthesis is weak. structuredOutput json_schema (the 2026-06-29 probe: it's not a reasoning model, so json_schema works — unlike the reasoning families). EVAL-HARNESS FITNESS (§5.AB, 2026-07-08, via json_schema): architect/decompose 3/3 = quality 1.000 (excellent, fast ~17s/cell); reviewer/review quality 0.556 (caught off-by-one + resource-leak + sql-injection, but MISSED the subtle null-deref and the TOCTOU race — a weaker reviewer than qwopus3.5-9b-coder@0.833). So: prefer coder-14b for DECOMPOSE/structured roles (fast + perfect), but it under-catches subtle concurrency/null defects on REVIEW. HIGH-POWER REFRESH CONFIRMS (§11 sweep 2026-07-11, mean 0.879): decompose 1.000 all tiers + worker tool-use 1.000, and reviewer 0.556 is REAL not power-masked (medium 0.000 = missed BOTH the null-deref AND unhandled-rejection, hard 0.667) — so the weak-reviewer verdict stands on high power. NEW: the 24k-context worker probe NO-ANSWER'd at the 301s cap even at high power (coder-14b is slow on long context — a latency ceiling at 24k). basis: empirical.",
		sources: [
			"https://github.com/QwenLM/Qwen3-Coder/issues/180",
			"live chat-agent e2e 2026-07-01 (scripts/verify-chat-agent-e2e.mts, model-lab guarded sweep — qwen2.5-coder-14b: all 4 tools + persist, weak synth, ~45s)",
			"live chat-agent e2e 2026-07-01 (model-lab guarded sweep on laptop — qwen2.5-coder-7b-instruct CLEAN PASS, ~18s, full synth — the 7B variant clears the full chain fast on the laptop's 8 GB GPU)",
		],
		basis: "both",
		verified: true,
	},
	{
		// The qwen3.5-122b HIGH-TIER MoE (A10B active). MORE SPECIFIC than the generic `qwen3.5` row below (which is
		// 9B-calibrated), so it MUST precede it — otherwise the 122B inherits the 9B's via_force/weak verdict. This is the
		// strongest result of the 2026-07-01 sweep: it does NOT need the force rung and it FULLY synthesizes.
		family: "qwen3.5-122b",
		match: /qwen-?3[._]5-122b/,
		toolUse: "TOOL_CAPABLE",
		kind: "reasoning",
		chaining: "native",
		synthesis: "full",
		structuredOutput: "native_tool_call",
		speed: "medium",
		sizeGb: 69,
		note: "qwen3.5-122b-a10b (arch qwen3_5, 122B MoE / ~10B active). The STRONGEST all-round result of the 2026-07-01 model-lab sweep: live e2e = CLEAN PASS (exit 0) — drove ALL 4 tools (read_file+run_command+create_card+update_focus_chain), PERSISTED the card, AND echoed the marker = FULL synthesis — NATIVELY (no §5.AB force-advance rung needed, unlike the smaller qwen3.5-9b reasoning row which only completes via the rung with weak synth). Medium speed (~77s, healthy for a 122B thanks to the A10B active-param MoE). ~69 GB resident (@4bit) — a real footprint cost, but headroom-safe on the 128 GB box (111.9 GiB free after load, ≥25% reserve). Being a reasoning family, json_schema structured output is expected to dead-end (§4A) — native tool_choice:required is the working lever. A distinct HIGH-TIER entry so the 122B is never scored against the 9B verdict.",
		sources: [
			"live chat-agent e2e 2026-07-01 (scripts/verify-chat-agent-e2e.mts, model-lab guarded sweep — qwen3.5-122b-a10b@4bit CLEAN PASS, exit 0, full synth, ~77s); see docs/dev/model-sweep-log.md",
		],
		basis: "empirical",
		verified: true,
	},
	{
		// qwen3.5 (arch `qwen3_5`) is a distinct REASONING family — MORE SPECIFIC than the generic `qwen3-8b` row
		// below and MUST precede it (its own regex `/qwen-?3-8b/` doesn't hit `qwen3.5-9b`, but keep specific→general).
		// NOTE: this row is 9B-CALIBRATED — the 122B has its OWN row ABOVE (don't let the 122B fall through to here).
		family: "qwen3.5",
		match: /qwen-?3[._]5/,
		toolUse: "TOOL_CAPABLE",
		kind: "reasoning",
		chaining: "via_force",
		synthesis: "weak",
		structuredOutput: "native_tool_call",
		speed: "medium",
		sizeGb: 6,
		note: "qwen3.5-9b (arch qwen3_5; ignores /no_think, still reasons — §4A). Completes the full 4-step agentic tool-chain + persists a card, but VIA !Klein's §5.AB force-advance rung; WITHOUT it it fixates and re-calls the first tool (not a clean native multi-tool chainer). Live 2026-07-01 e2e = PASS/PARTIAL (chain executed + card PERSISTED; only miss = final reply lacks the marker string = weak SYNTHESIS, not a capability gap). Per §4A json_schema structured output DEAD-ENDS on it — native tool_choice:required is the working lever. Medium speed (~6 GB resident 9B). UPDATE 2026-07-01: on the desktop (fresh-loaded, 24 GB, device-targeted) a clean e2e = FULL PASS (172s) WITH the marker echoed — so its synthesis is STOCHASTIC (full IS achievable), not fixed-weak; the §5.AB force-advance still carries the chain.",
		sources: [
			"live chat-agent e2e 2026-07-01 (scripts/verify-chat-agent-e2e.mts; commits dec62245+89becd66); todo §5.AA/§5.AB force-advance + §4A structured-output-strategy/thinking-control notes",
		],
		basis: "empirical",
		verified: true,
	},
	{
		// Qwen3 0.6B — the smallest Qwen3. Its `0-6b` token can't hit `qwen3-8b`, so order vs the 8B is not load-bearing.
		family: "qwen3-0.6b",
		match: /qwen-?3-0[._-]?6b/,
		toolUse: "TOOL_WEAK",
		kind: "instruct",
		chaining: "single_only",
		synthesis: "full",
		speed: "fast",
		sizeGb: 0.4,
		note: "Qwen3 0.6B (the smallest Qwen3). §11 sweep 2026-07-11 (m5max, chat-agent-tools single-read probe): a NOTABLE floor result — even at 0.6B it CALLED read_file (audited ✓) AND fully synthesized the answer (echoed the file's secret verbatim), a CLEAN single-tool PASS. So single-tool call + full synthesis is achievable even at the 0.6B floor — the qwen3 lineage synthesizes well tiny, unlike the coder-tuned/gemma-edge ≤7B rows that abbreviate to 'Done.' on the same probe (single-tool synth is family/tuning-, not size-, gated). MULTI-tool chaining NOT tested and expected to fail at 0.6B (below the ≤4B chaining floor) — kept TOOL_WEAK/single_only, mirroring nemotron-nano's treatment. n=1; a data point, not a worker recommendation.",
		sources: [
			"https://qwenlm.github.io/blog/qwen3/",
			"live chat-agent-tools 2026-07-11 (m5max, `qwen3-0.6b-mlx` ~0.4 GB — single read_file + full synth PASS; §11 sweep increment)",
		],
		basis: "empirical",
		verified: true,
	},
	{
		family: "qwen3-8b",
		match: /qwen-?3-8b/,
		toolUse: "TOOL_NATIVE",
		kind: "agentic",
		note: "Marketed for agentic tool use (Qwen-Agent, MCP). Strong single-turn; multi-turn chaining is STOCHASTIC — live 2026-06-29 (HIGH power, fresh-loaded, back-to-back e2e): run 1 narrated steps 2-4 as prose → INCOMPLETE (the evidence-gate correctly refused the false 'done'), run 2 drove the full chain + persisted → PASS. Our best small performer, but don't assume a single run is representative. EVAL-HARNESS FITNESS (§11 sweep 2026-07-11, m5max low-power, native_tool_call, mean 0.931/12 cells): architect/decompose 1.000 (PERFECT — easy+medium+hard all landed via the tool channel, ~10.7s avg) and worker/tool-use+context 1.000 (perfect: simple/multi-select/irrelevance tool-use AND 2k/8k/24k context probes) — but reviewer quality 0.722 / reliability 0.667 (easy 1.0, medium 0.5 = missed part of the null/unhandled-rejection pair, hard 0.667 = partial on the race/leak/injection trio). So qwen3-8b is a TOP architect/decompose + worker pick but a WEAK reviewer (misses subtle null/concurrency defects — the same small-model reviewer ceiling as coder-14b 0.556 and qwopus3.5-9b 0.833); pair it with review lenses or route review to a stronger model. basis: empirical.",
		sources: [
			"https://qwenlm.github.io/blog/qwen3/",
			"eval-harness 2026-07-11 (m5max low-power, qwen/qwen3-8b: mean 0.931/12 — decompose 1.0, worker 1.0, reviewer 0.722); see docs/dev/model-sweep-log.md",
		],
		basis: "both",
		verified: true,
	},
	// ── qwen3 coder-next + larger qwen3 sizes (2026-07-01 fleet sweep) ─────────────────────────────────────
	{
		// Qwen3-Coder-Next — purpose-built agentic coder; NOT shadowed by qwen3.5/qwen3-8b (distinct "coder-next" token).
		family: "qwen3-coder-next",
		match: /qwen-?3-coder(-next)?/,
		toolUse: "TOOL_CAPABLE",
		kind: "agentic",
		chaining: "native",
		synthesis: "full",
		structuredOutput: "native_tool_call",
		speed: "fast",
		sizeGb: 45,
		note: "Qwen3-Coder-Next (arch qwen3_next, ~80B MoE agentic coder). Live e2e 2026-07-01 (model-lab guarded sweep, m5): CLEAN PASS (exit 0) — drove ALL 4 tools (read+command+create_card+focus_chain) + PERSISTED the card + echoed the marker = FULL synthesis, FAST (~25s). Purpose-built for agentic coding and behaves like it — a top-tier local DRIVER candidate. ~45 GB resident, headroom-safe on the 128 GB box.",
		sources: [
			"live chat-agent e2e 2026-07-01 (scripts/verify-chat-agent-e2e.mts, model-lab guarded sweep — qwen3-coder-next CLEAN PASS, exit 0, full synth, ~25s); see docs/dev/model-sweep-log.md",
		],
		basis: "empirical",
		verified: true,
	},
	{
		// qwen3-14b — the NON-reasoning qwen3 (arch qwen3); n=1 result, verified:false. Distinct from qwen3.5/qwen3.6.
		family: "qwen3-14b",
		match: /qwen-?3-14b/,
		toolUse: "TOOL_WEAK",
		kind: "instruct",
		chaining: "fails",
		synthesis: "weak",
		speed: "slow",
		sizeGb: 9,
		note: "qwen3-14b (arch qwen3). Live e2e 2026-07-01 (model-lab guarded sweep, ON THE LAPTOP 8 GB-VRAM box): ❌ INCOMPLETE (122s) — card not persisted (dropped the chain). ODDLY weaker than the coder-7b + gemma-4-12b that PASS on the same box, so possibly a stochastic miss rather than a hard ceiling — n=1, verdict PROVISIONAL (verified:false; ×3 re-run owed, ideally on faster HW to rule out a speed confound).",
		sources: [
			"live chat-agent e2e 2026-07-01 (scripts/verify-chat-agent-e2e.mts, model-lab guarded sweep on laptop — qwen3-14b ❌ INCOMPLETE 122s, n=1); see docs/dev/model-sweep-log.md",
		],
		basis: "empirical",
		verified: false,
	},
	{
		// qwen3.6-27b (base qwen3.6, arch qwen35) — NOT the qwopus3.6 merge (own row above). First SETTLED-depth
		// empirical evidence 2026-07-10 (eval harness, 4 repeats/cell on the m5max, LOW-POWER mode).
		family: "qwen3.6-27b",
		match: /qwen-?3[._]6-27b/,
		toolUse: "TOOL_CAPABLE",
		kind: "reasoning",
		speed: "slow",
		sizeGb: 17,
		note: "qwen3.6-27b (base qwen3.6 reasoning family; the qwopus3.6-27b MERGE has its own row). SETTLED eval evidence 2026-07-10 (§5.AB harness, 4 repeats/cell, m5max LOW-POWER): TOOL USE PERFECT — 12/12 across easy/medium/hard incl. the irrelevance probe (settled_pass, spread 0). DECOMPOSE strong easy+medium (settled 1.0). HARD-DECOMPOSE CAVEAT RESOLVED (§11 sweep 2026-07-11, HIGH power re-run, mean 0.894/11): the hard cell was NOT a power timeout — at high power it finished in 121s (well under the cap) yet still produced **NO ANSWER**, so the hard-decompose gap is a GENUINE ceiling for the 27b base, not a latency artifact. REVIEWER WEAKNESS CONFIRMED real (not power-masked): high power reviewer 0.611 quality / 0.333 reliability (medium 0.5, HARD 0.333 — caught only 1 of race/leak/injection), matching the low-power settled numbers. So the 27b BASE is a WEAK reviewer — and note the intra-family split: the qwen3.6-35b-a3b MoE reviews at 0.833 (catches the hard trio) while this 27b base sits at 0.333, so within qwen3.6 route review to the 35b-a3b MoE (or nemotron-nano-4b), never the 27b base. Prefer a different family for the reviewer role or pair with review lenses.",
		sources: [
			"live chat-agent e2e 2026-07-01 (laptop, speed-confounded INCOMPLETE @840s); see docs/dev/model-sweep-log.md",
			"eval harness 2026-07-10 (scripts/eval-harness.mts, NKLEIN_EVAL_REPEATS=4, persisted to fitness-table): mean 0.854/32 cells — worker 1.0/1.0, architect 1.0 quality @maxDiff 0.66, reviewer 0.611 quality/0.333 reliability",
		],
		basis: "both",
		verified: true,
	},
	{
		// ravenx — a heavy custom MERGE on the qwen3.6-35b-a3b base (cyberagent/pentester/bughunter/opus/openmythos).
		// MUST precede the plain 35b-a3b row: the ravenx id CONTAINS "qwen3.6-35b-a3b", so the base pattern would
		// otherwise shadow it (most-specific-first).
		family: "ravenx-pentester-merge",
		match: /ravenx|cyberagent.*pentester/,
		toolUse: "TOOL_WEAK",
		kind: "reasoning",
		speed: "slow",
		sizeGb: 69,
		note: "ravenx-cyberagent-qwen3.6-35b-a3b-opus-4.7-openmythos-pentester-bughunter merge (~69 GB, MLX). §11 sweep 2026-07-11 (m5max HIGH power, eval-harness, mean 0.833/9 SCORED): the security-tuning-boosts-review hypothesis is REFUTED, and the merge is STRICTLY WORSE than its base qwen3.6-35b-a3b. DECOMPOSE BROKEN: all 3 architect cells NO ANSWER (the heavy merge disrupted the structured decompose_project tool-call — the base scores 1.0 here). REVIEWER 0.833 = IDENTICAL to the base (caught the hard trio, missed the medium null-deref) — the pentester/bughunter tuning added NOTHING to review recall over the base 35b-a3b. Worker mostly 1.0 but tooluse-simple-weather 0.000. So: do NOT route decompose (or reliable tool-work) here; it reviews only as well as its base at 3× the base's footprint. Lesson: a heavy multi-way capability merge can DEGRADE the base's structured-output/tool-calling without improving the target skill — prefer the clean base (qwen3.6-35b-a3b) for both decompose AND review. basis: empirical.",
		sources: [
			"eval-harness 2026-07-11 (m5max HIGH power, ravenx-…-pentester-bughunter: mean 0.833/9 — decompose ALL NO-ANSWER, reviewer 0.833 = same as base, worker 0.833); see docs/dev/model-sweep-log.md",
			"chat-agent-tools 2026-07-11 (single-read PASS — single-tool works; the STRUCTURED decompose call is what the merge broke)",
		],
		basis: "empirical",
		verified: true,
	},
	{
		// qwen3.6-35b-a3b (base qwen3.6 MoE, ~35B total / ~3B active). Its `35b-a3b` token can't hit the 27b row.
		family: "qwen3.6-35b-a3b",
		match: /qwen-?3[._]6-35b[._-]?a3b/,
		toolUse: "TOOL_CAPABLE",
		kind: "reasoning",
		speed: "slow",
		sizeGb: 22,
		note: "qwen3.6-35b-a3b (base qwen3.6 reasoning MoE, ~3B active). §11 sweep 2026-07-11 (m5max HIGH power, eval-harness native_tool_call, mean 0.955/11 scored cells): worker/tool-use + all context probes 1.000; decompose 1.000 on medium+hard (easy cell NO-ANSWER — a reasoning over-think on the trivial prompt, ~41s, not a refusal); and — the standout — REVIEWER quality 0.833 (easy 1.0, medium 0.5, HARD 1.0: it CAUGHT the full race/leak/injection trio). That is a REAL reviewer UPGRADE over the qwen3.6-27b base (0.333 on the hard trio) and over the small-model ceiling (~0.72): the bigger a3b MoE is the strongest REVIEWER swept so far — a viable route for the reviewer role the smaller models fail. Also chat-agent-tools single-tool PASS. Cost: slow reasoning cells (~40s decompose, ~25s review) even at high power. basis: empirical.",
		sources: [
			"eval-harness 2026-07-11 (m5max HIGH power, qwen/qwen3.6-35b-a3b: mean 0.955/11 — worker 1.0, decompose 1.0 med+hard, reviewer 0.833 incl. the hard trio); see docs/dev/model-sweep-log.md",
			"chat-agent-tools 2026-07-11 (single-read PASS, call+synth)",
		],
		basis: "empirical",
		verified: true,
	},
	{
		// QwQ-32B (Qwen's dense reasoning model). Its `qwq` token is unique — no collision with the qwen3/coder rows.
		family: "qwq-32b",
		match: /qwq-?32b/,
		toolUse: "TOOL_CAPABLE",
		kind: "reasoning",
		speed: "slow",
		sizeGb: 35,
		note: "QwQ-32B (Qwen dense reasoning). §11 sweep 2026-07-11 (m5max HIGH power, eval-harness native_tool_call, mean 0.955/11): worker/tool-use + context probes 1.000; decompose 1.000 on easy+hard (medium NO-ANSWER — reasoning over-think, hit the harness cell cap); REVIEWER quality 0.833 (caught the hard race/leak/injection trio — a STRONG reviewer, ties qwen3.6-35b-a3b). Also chat-agent-tools single-tool PASS. BUT PROHIBITIVELY SLOW: decompose cells took 191-272s EACH and review cells ~140-168s — the full 12-cell eval ran ~22 MINUTES even at HIGH power (it over-thinks massively). Same quality as qwen3.6-35b-a3b (both 0.955, both reviewer 0.833) at 4-6× the latency, so PREFER qwen3.6-35b-a3b for the reviewer role — QwQ's quality is real but its latency makes it impractical for unattended/interactive use. speed:slow is an understatement. basis: empirical.",
		sources: [
			"eval-harness 2026-07-11 (m5max HIGH power, qwen/qwq-32b: mean 0.955/11 — reviewer 0.833, but ~3-4min/decompose cell, ~22min total); see docs/dev/model-sweep-log.md",
			"chat-agent-tools 2026-07-11 (single-read PASS, call+synth)",
		],
		basis: "empirical",
		verified: true,
	},
	// ── OpenAI gpt-oss (open-weight MoE) — 2026-07-01 fleet sweep: chaining tracks ACTIVE params ──────────────
	{
		family: "gpt-oss-120b",
		match: /gpt-?oss-120b/,
		toolUse: "TOOL_CAPABLE",
		kind: "reasoning",
		chaining: "native",
		synthesis: "full",
		structuredOutput: "native_tool_call",
		speed: "fast",
		sizeGb: 63,
		note: "OpenAI gpt-oss-120b (open-weight MoE, ~116B total / ~5.1B active). Live e2e 2026-07-01 (model-lab guarded sweep, m5): CLEAN PASS (exit 0) — drove ALL 4 tools + PERSISTED the card + echoed the marker = FULL synthesis, and FAST (~22s, thanks to the ~5B active-param MoE). ~63 GB resident, headroom-safe on the 128 GB box. A high-tier winner. KEY CONTRAST with the gpt-oss-20b sibling (TOOL_WEAK): gpt-oss chaining tracks ACTIVE params — 5.1B here clears the full chain, 3.6B on the 20b does not. EVAL-HARNESS FITNESS (§11 sweep 2026-07-11, HIGH power, first eval-harness scores for it — mean 0.875/12): decompose 1.000 all tiers (fast ~5s/cell) + REVIEWER 0.833 (caught the hard race/leak/injection trio) — another NON-qwen model that BREAKS the reviewer ceiling, reinforcing that strong review recall is model-specific (the qwen instruct/coder family is the one that under-catches). Worker mostly 1.0 but context-probe-8k scored 0.000 — CONFIRMED a HARNESS BUG (the same non-breaking-hyphen typography issue that hit nemotron-nano; fixed 2026-07-11), NOT a model gap, so its true worker is 1.0 and mean ~0.958. Good reviewer but 63 GB — impractical vs phi-4-mini-instruct@8bit (same 0.833 review at 3.8 GB). basis: empirical.",
		sources: [
			"live chat-agent e2e 2026-07-01 (scripts/verify-chat-agent-e2e.mts, model-lab guarded sweep — gpt-oss-120b CLEAN PASS, exit 0, full synth, ~22s); see docs/dev/model-sweep-log.md",
		],
		basis: "empirical",
		verified: true,
	},
	{
		family: "gpt-oss-20b",
		match: /gpt-?oss-20b/,
		toolUse: "TOOL_WEAK",
		kind: "reasoning",
		chaining: "single_only",
		synthesis: "weak",
		speed: "fast",
		sizeGb: 22,
		note: "OpenAI gpt-oss-20b (open-weight MoE, ~21B total / ~3.6B active). Live e2e 2026-07-01 ×3 (model-lab guarded sweep, m5): 0/3 — drives read_file + run_command then DROPS create_card + update_focus_chain (card never persisted), INCOMPLETE every run (~39-59s). A multi-tool CHAIN-dropper despite 20B total — consistent with the ≤~4B-active chaining floor (only ~3.6B active), while its 120b sibling (~5.1B active) clears the chain cleanly. Fine for single-tool use; not a reliable multi-step tool-chainer. ⭐ BUT the TOOL_WEAK verdict is ONLY about multi-tool CHAINING — on SINGLE-STRUCTURED-CALL roles it is STRONG (§11 sweep 2026-07-11, HIGH power, eval-harness mean 0.958/12): DECOMPOSE 1.000 all tiers + worker/tool-use + all context probes 1.000, and REVIEWER 0.833 (caught the hard race/leak/injection trio — another non-qwen breaking the reviewer ceiling). Same shape as nemotron-nano: chain-weak, single-call-strong. So gpt-oss-20b is a viable fast DECOMPOSE/REVIEW/single-tool-worker model (0.958) — just never a multi-tool chainer. basis: empirical.",
		sources: [
			"live chat-agent e2e 2026-07-01 ×3 (scripts/verify-chat-agent-e2e.mts, model-lab guarded sweep — gpt-oss-20b-mlx 0/3, chain-drop); see docs/dev/model-sweep-log.md",
		],
		basis: "empirical",
		verified: true,
	},
	// ── Mistral 24B family ────────────────────────────────────────────────────────────────────────────────
	{
		family: "magistral-small",
		match: /magistral/,
		toolUse: "TOOL_WEAK",
		kind: "reasoning",
		note: "Reasoning-first. Function calling is undocumented on the cards, disabled in official GGUF/Ollama builds, and reasoning-mode + tool parsing returns empty tool_calls. Weakest Mistral for tool use. CONTRADICTION 2026-07-01 (model-lab guarded e2e, magistral-small-2509, LM Studio quant): a CLEAN PASS — drove ALL 4 tools + PERSISTED the card AND echoed the marker (FULL synthesis, exit 0, ~54s). So this LM Studio quant does function-calling well, opposite the 'empty tool_calls' report above — a strong LIFT candidate. Held at TOOL_WEAK on this single run; owed: ×3 re-run to confirm before lifting the verdict.",
		sources: [
			"https://github.com/vllm-project/vllm/issues/30139",
			"live chat-agent e2e 2026-07-01 (scripts/verify-chat-agent-e2e.mts, model-lab guarded sweep — magistral-small-2509 CLEAN PASS: all 4 tools + persist + full synth; contradicts the empty-tool_calls report)",
		],
		basis: "both",
		verified: true,
	},
	{
		family: "devstral-small",
		match: /devstral/,
		toolUse: "TOOL_NATIVE",
		kind: "agentic",
		chaining: "native",
		synthesis: "full",
		speed: "fast",
		sizeGb: 14,
		note: "Purpose-built agentic coding model (Mistral × All Hands); tool use is the whole point (53.6% SWE-Bench Verified). Chaining bugs traced to GGUF template mismatches, not the model — use official quants. EMPIRICALLY CONFIRMED 2026-07-01 (model-lab guarded e2e, devstral-small-2-2512, 24B): CLEAN PASS (exit 0) — drove ALL 4 tools natively + PERSISTED the card + echoed the marker = FULL synthesis, fast (~42s). One of only 3 full-synth winners in the sweep (with magistral + qwen3.5-122b). Verdict research→both.",
		sources: [
			"https://mistral.ai/news/devstral-2507/",
			"live chat-agent e2e 2026-07-01 (scripts/verify-chat-agent-e2e.mts, model-lab guarded sweep — devstral-small-2-2512 CLEAN PASS: all 4 tools + persist + full synth, ~42s)",
		],
		basis: "both",
		verified: true,
	},
	{
		family: "mistral-small",
		match: /mistral-small-3\.?2|mistral-small/,
		toolUse: "TOOL_NATIVE",
		kind: "instruct",
		chaining: "native",
		synthesis: "weak",
		speed: "fast",
		sizeGb: 14,
		note: 'First-class function calling; 3.2 shipped a "more robust function calling template". Reported failures are GGUF chat-template bugs (fixed in good quants), not model limitations. EMPIRICALLY CONFIRMED 2026-07-01 (model-lab guarded e2e, mistral-small-3.2, 24B): drove ALL 4 tools natively + PERSISTED the card (chain ✓), but WEAK synthesis (final reply didn\'t echo the marker); FASTEST 24B in the sweep (~21s). So native chaining confirmed; only the final synthesis was weak this run. Verdict research→both. EVAL-HARNESS FLEET SWEEP (§5.AB, 2026-07-08, 8-model roster): strong FAST all-rounder — mean 0.833 over all 6 cells in just 59s (the SPEED CHAMP of the roster), architect/decompose 3/3 via json_schema. Confirms TOOL_NATIVE + fast: an excellent low-latency structured-role pick. basis: empirical.',
		sources: [
			"https://huggingface.co/mistralai/Mistral-Small-3.2-24B-Instruct-2506",
			"live chat-agent e2e 2026-07-01 (scripts/verify-chat-agent-e2e.mts, model-lab guarded sweep — mistral-small-3.2: all 4 tools + persist, weak synth, ~21s)",
		],
		basis: "both",
		verified: true,
	},
	// ── Meta ──────────────────────────────────────────────────────────────────────────────────────────────
	{
		family: "llama-3.3-70b",
		match: /llama-?3\.?3-70b/,
		toolUse: "TOOL_NATIVE",
		kind: "instruct",
		note: "Official Meta tool support (built-in + custom JSON FC); rated most reliable on chained tool calls among local models. Limiting factor is planning depth, not call formatting. Meta recommends 70B (not 8B) for tools.",
		sources: ["https://huggingface.co/meta-llama/Llama-3.3-70B-Instruct"],
		basis: "research",
		verified: true,
	},
];

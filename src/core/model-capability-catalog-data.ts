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
		note: 'Math-reasoning-only; the card states it is "designed and tested for math reasoning only" and never mentions tool use. Use phi-4-mini-instruct instead for tool chains.',
		sources: ["https://huggingface.co/microsoft/Phi-4-mini-reasoning"],
		basis: "research",
		verified: true,
	},
	{
		family: "phi-4-reasoning-plus",
		match: /phi-?4-reasoning(-plus)?/,
		toolUse: "TOOL_UNSUITABLE",
		kind: "reasoning",
		note: 'Pure chain-of-thought reasoning model. Microsoft staff: "Function calling is only supported on Phi-4-mini-based models." No tool format in the chat template.',
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
		note: 'The only Phi-4 variant trained for function calling (<|tool|> JSON). Fragile in practice — parser bugs across frameworks and the card admits it "could sometimes hallucinate function names". Our sweeps: ◑ with the constrained rung. 2026-07-01 (model-lab guarded e2e, phi-4-mini-instruct@4bit): drove ALL 4 tools + PERSISTED the card, WEAK synthesis (no marker echo), VERY fast (~5s) — the full chain fired natively in this harness (the §5.AB force-advance wiring appears to carry it). Notable as a ~2B-class model clearing the multi-tool chain; kept TOOL_CAPABLE (chain ✓, synth weak). Re-run to confirm stability given its known fragility.',
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
		note: "SFT+RL post-trained for tool calling with a parser + 128k context, BUT user reports show the 4B emitting tool calls as plain text and failing once multiple tools are present (NIM + Ollama). Live-confirmed 2026-06-29 on nvidia/nemotron-3-nano-4b via the chat-agent e2e: it used read_file then DROPPED the chain (no run_command/create_card/focus-chain) — single-tool only, fails multi-tool chaining (consistent with the ≤4B floor). RECONFIRMED 2026-07-01 (model-lab guarded sweep, exit 0 but SINGLE-TOOL only): again used read_file then dropped the chain — the ONLY tested model that did NOT chain even under the §5.AB force-advance wiring that carried the others through. It echoed the marker yet FALSELY claimed all 4 steps were done (narration, not execution). TOOL_WEAK, chaining single_only firmly stands; fast (~54s).",
		sources: [
			"https://community.n8n.io/t/nvidia-llama-3-1-nemotron-nano-4b-v1-1-tool-calling-issue/135282",
			"live chat-agent e2e 2026-07-01 (scripts/verify-chat-agent-e2e.mts, model-lab guarded sweep — nemotron-3-nano-4b: single-tool only, dropped the chain, false 'all steps done')",
		],
		basis: "both",
		verified: true,
	},
	// ── DeepSeek R1 distill (matched BEFORE Qwen: its id contains "qwen3-8b" but it's a reasoning distill) ──
	{
		family: "deepseek-r1-distill",
		match: /deepseek-r1.*qwen3?-8b|deepseek-r1-0528/,
		toolUse: "TOOL_WEAK",
		kind: "reasoning",
		note: 'Reasoning distill: card claims "enhanced function calling" but ships no parser/template; calls leak into content and </think> tags break parsers. Poor fit for unattended tool chaining.',
		sources: ["https://github.com/vllm-project/vllm/issues/19001"],
		basis: "research",
		verified: true,
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
		note: "qwopus3.5 lineage (arch qwen3_5, coder-tuned). The 4B CODER variant (qwopus3.5-4b-coder-fable5-v1-mlx) live 2026-07-01 FULLY PASSED the 4-step agentic chain (exit 0: read_file+run_command+create_card+update_focus_chain, card PERSISTED, AND the reply echoed the marker = full SYNTHESIS) — natively, no force-advance rung needed — notably OUTPERFORMING the bigger qwopus3.6-27b + qwen3.5-9b REASONING variants (only PARTIAL: weak final synthesis). Fast + tiny (~2.4 GB). Lesson: for DIRECT agentic tool use, coder/instruct tuning beats reasoning-heavy tuning — size is NOT the deciding factor. structuredOutput unknown (json_schema vs native not probed on it — left honest). SIZE/VARIANT NUANCE (2026-07-01 model-lab sweep, now verified up): the 9b-coder (@8bit) drove ALL 4 tools + persisted but WEAK synthesis (~67s, medium); mlx-27b-v3 also ALL 4 + persist but WEAK synth AND SLOW (~301s, an MLX 27B latency outlier vs the 26B qat at 34s). So the strong FULL-synth result is specific to the 4B coder — the 9B/27B siblings chain fine but under-summarize; the fields below reflect the 4B (best-in-family). The chaining capability holds across the sizes; only the 4B gets full synthesis. 2026-07-08 (qwopus3.5-9b-coder-mtp, resident): drove decompose_project (7 cards, via §5.AG auto-promote to In Progress); reasoning capture works (§5.O — 197 role:reasoning deltas during thinking); online retrieval synthesis produced a cited answer; and the §5.AD enforced-reasoning bounce turned a naive median() one-liner into a correct comparator-sorted impl (so the 9B CAN reach full-quality output when the bounce loop runs — the weak-synth note is the FIRST-pass behavior). CAVEAT (sweep run 9, 2026-07-08): as a WORKER on a small card the 9b-coder-mtp ran a single generation away for 15+ min (degenerate loop, no tool call, no progress) — with agentTimeoutMode:unlimited there was no wall-clock backstop so it froze the card. Prefer a stronger coder (e.g. qwen2.5-coder-14b) for small worker slots, or gate the 9B behind the runaway-generation detector (runaway-generation-detector.ts). basis: empirical.",
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
		family: "qwen2.5-coder",
		match: /qwen2\.?5-coder/,
		toolUse: "TOOL_CAPABLE",
		kind: "code",
		chaining: "native",
		synthesis: "weak",
		structuredOutput: "json_schema",
		speed: "fast",
		sizeGb: 8.3,
		note: "Supports tool calling; historically emitted a non-Hermes <tools>/code-block format that failed SILENTLY unless the parser matched. BUT live 2026-06-29 on `qwen/qwen2.5-coder-14b` via LM Studio's OpenAI `/v1`: a single-tool prompt returned a CLEAN STRUCTURED `tool_calls` (`create_card({title})`, finish=tool_calls) AND `response_format json_schema` produced valid structured output — so LM Studio's parser DOES surface its single-tool calls (not silently failing at that grain). Not a reasoning model (reasoning_len 0). The ◑ at 14B caveat is about multi-tool CHAINING, which the constrained rung helps. MULTI-TOOL CHAIN CONFIRMED 2026-07-01 (model-lab guarded e2e, qwen2.5-coder-14b): drove ALL 4 tools + PERSISTED the card this run (chaining native — no visible force rung needed), WEAK synthesis (no marker echo), fast (~45s). So the CHAINING caveat is lifted here; only synthesis is weak. structuredOutput json_schema (the 2026-06-29 probe: it's not a reasoning model, so json_schema works — unlike the reasoning families).",
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
		family: "qwen3-8b",
		match: /qwen-?3-8b/,
		toolUse: "TOOL_NATIVE",
		kind: "agentic",
		note: "Marketed for agentic tool use (Qwen-Agent, MCP). Strong single-turn; multi-turn chaining is STOCHASTIC — live 2026-06-29 (HIGH power, fresh-loaded, back-to-back e2e): run 1 narrated steps 2-4 as prose → INCOMPLETE (the evidence-gate correctly refused the false 'done'), run 2 drove the full chain + persisted → PASS. Our best small performer, but don't assume a single run is representative.",
		sources: ["https://qwenlm.github.io/blog/qwen3/"],
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
		// qwen3.6-27b (base qwen3.6, arch qwen35) — NOT the qwopus3.6 merge (own row above). Only data is a SPEED-CONFOUNDED
		// laptop run, so the verdict is research-led + verified:false — do NOT read a slow-HW timeout as incapacity.
		family: "qwen3.6-27b",
		match: /qwen-?3[._]6-27b/,
		toolUse: "TOOL_CAPABLE",
		kind: "reasoning",
		speed: "slow",
		sizeGb: 17,
		note: "qwen3.6-27b (base qwen3.6 reasoning family; the qwopus3.6-27b MERGE — the backlog driver — has its own row and drives multi-tool chains fine). Only live data 2026-07-01 is SPEED-CONFOUNDED: on the LAPTOP (8 GB VRAM + 32 GB RAM) it ran ~14 min (840s) mostly RAM-bound and hit INCOMPLETE — a throughput/timeout artifact, NOT a capability ceiling (the known 'a 27B is too slow for a multi-turn tool-chain in-window' pattern). Held TOOL_CAPABLE (the 3.6 gen chains natively on adequate HW), verified:false — a CLEAN run owed on a fast box.",
		sources: [
			"live chat-agent e2e 2026-07-01 (scripts/verify-chat-agent-e2e.mts, model-lab guarded sweep on laptop — qwen3.6-27b INCOMPLETE @840s, speed-confounded); see docs/dev/model-sweep-log.md",
		],
		basis: "both",
		verified: false,
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
		note: "OpenAI gpt-oss-120b (open-weight MoE, ~116B total / ~5.1B active). Live e2e 2026-07-01 (model-lab guarded sweep, m5): CLEAN PASS (exit 0) — drove ALL 4 tools + PERSISTED the card + echoed the marker = FULL synthesis, and FAST (~22s, thanks to the ~5B active-param MoE). ~63 GB resident, headroom-safe on the 128 GB box. A high-tier winner. KEY CONTRAST with the gpt-oss-20b sibling (TOOL_WEAK): gpt-oss chaining tracks ACTIVE params — 5.1B here clears the full chain, 3.6B on the 20b does not.",
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
		note: "OpenAI gpt-oss-20b (open-weight MoE, ~21B total / ~3.6B active). Live e2e 2026-07-01 ×3 (model-lab guarded sweep, m5): 0/3 — drives read_file + run_command then DROPS create_card + update_focus_chain (card never persisted), INCOMPLETE every run (~39-59s). A multi-tool CHAIN-dropper despite 20B total — consistent with the ≤~4B-active chaining floor (only ~3.6B active), while its 120b sibling (~5.1B active) clears the chain cleanly. Fine for single-tool use; not a reliable multi-step tool-chainer.",
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
		note: 'First-class function calling; 3.2 shipped a "more robust function calling template". Reported failures are GGUF chat-template bugs (fixed in good quants), not model limitations. EMPIRICALLY CONFIRMED 2026-07-01 (model-lab guarded e2e, mistral-small-3.2, 24B): drove ALL 4 tools natively + PERSISTED the card (chain ✓), but WEAK synthesis (final reply didn\'t echo the marker); FASTEST 24B in the sweep (~21s). So native chaining confirmed; only the final synthesis was weak this run. Verdict research→both.',
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

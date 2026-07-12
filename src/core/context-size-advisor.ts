/**
 * §5.AQ B2 — the observation-based CONTEXT-SIZE ADVISOR. A pure, read-only recommender that looks at how much context a
 * model is LOADED with versus how much it actually USES and how slow its PREFILL is, and suggests a smaller context cap
 * ONLY when a large window is demonstrably wasted (slow prefill over KV that never carries task tokens). Advisory only —
 * it never applies anything; a caller (`nklein dev capacity` / Settings) surfaces it as a non-blocking hint.
 *
 * Why (user 2026-06-29, sharpened by the low-power fleet 2026-07): on a slow/low-power box the PREFILL of a big loaded
 * context dominates wall-clock — every request re-reads a huge KV cache even when the prompt is small. But a naive "just
 * shrink the window" hurts complex-codebase work, so this advisor is deliberately CONSERVATIVE:
 *   • it NEVER suggests going below {@link import("./turn-budget-allocator").MIN_CONTEXT_FLOOR_TOKENS} (the ≥32k floor);
 *   • it distinguishes a BLOATED window (loaded ≫ used) from a large-but-NECESSARY one (loaded ≈ used) — the latter is
 *     kept, and if it is also slow the advice is to ROUTE those tasks to a stronger machine, never to cut the window;
 *   • a window being OVERFLOWED (peak usage ≥ loaded) is flagged as too-SMALL, never cut;
 *   • every reduce suggestion carries the EVIDENCE (the numbers) and the compensating mechanisms that keep a weak box
 *     useful on big codebases (JIT retrieval, compaction, stable-prefix caching, smaller cards, stronger-machine routing).
 *
 * Pure + deterministic over injected observations (a ledger replay reproduces every verdict) — no I/O, no clock, no
 * model calls. The wiring maps the ledger speed rollup + registry prompt-token EWMA + `lms ps` loaded-context into
 * {@link ContextSizeObservation}; this module only DECIDES.
 */

import { MIN_CONTEXT_FLOOR_TOKENS } from "./turn-budget-allocator";

/** Below this loaded-context UTILIZATION (typical prompt ÷ loaded window) the window is "over-provisioned" (reduce candidate). */
export const OVER_PROVISIONED_UTILIZATION = 0.4;
/** At/above this utilization the window is "well used" — kept, not cut (large-but-necessary). */
export const WELL_USED_UTILIZATION = 0.7;
/** Prefill (avg time-to-first-token) at/above this is "slow" — the wasted-KV cost the advisor targets. */
export const SLOW_TTFT_MS = 3000;
/** Headroom multiplier over PEAK observed prompt tokens when proposing a cap (never cut into real usage + its spikes). */
export const CAP_HEADROOM_OVER_PEAK = 1.5;
/** Minimum timing samples before the advisor will make a (non-"insufficient-data") recommendation. */
export const MIN_SAMPLES_FOR_RECOMMENDATION = 5;
/** Only propose a cap when it frees at least this fraction of the loaded window (else the churn isn't worth it). */
export const MIN_SAVINGS_RATIO = 0.2;

/** One model×host observation the advisor reasons over. All fields INJECTED by the caller from real telemetry. */
export interface ContextSizeObservation {
	/** The model key (registry/ledger id). */
	modelId: string;
	/** Optional host/device the stats are for (e.g. `m5max`); folded into evidence for a per-host suggestion. */
	hostId?: string | null;
	/** The context length the model is currently LOADED with (its KV window), from `lms ps`. */
	loadedContextTokens: number;
	/** Typical (EWMA/median) prompt-token usage; `null`/absent ⇒ unknown (no reduce recommendation possible). */
	typicalPromptTokens?: number | null;
	/** Peak observed prompt tokens (high-water mark a cap must not cut); falls back to typical when absent. */
	peakPromptTokens?: number | null;
	/** Average prefill latency (time-to-first-token, ms) — the slow-prefill signal. */
	avgTtftMs?: number | null;
	/** Median decode throughput (tokens/sec) — context for the evidence line. */
	medianTokensPerSec?: number | null;
	/** Number of timing samples behind these stats (drives confidence + the min-samples gate). */
	sampleCount: number;
	/** Whether this host runs in low-power mode (slow prefill is expected there — strengthens a reduce suggestion). */
	lowPowerMode?: boolean;
}

/** What the advisor suggests for a single observation. */
export type ContextSizeRecommendationKind =
	/** Loaded window is much larger than used AND prefill is slow ⇒ propose a smaller cap. */
	| "reduce_context"
	/** Window is well used (or usage unknown / too few samples) ⇒ leave it. */
	| "keep"
	/** Window is large-and-necessary but slow, OR peak usage overflows it ⇒ route those tasks to a stronger machine. */
	| "route_to_stronger_machine";

/** Confidence in a recommendation — a direct function of how many timing samples support it. */
export type ContextSizeConfidence = "low" | "medium" | "high";

/** A single per-observation recommendation with its evidence + safety notes. */
export interface ContextSizeRecommendation {
	modelId: string;
	hostId?: string | null;
	kind: ContextSizeRecommendationKind;
	/** The loaded window this is about (tokens). */
	loadedContextTokens: number;
	/** The suggested cap (tokens) — present only for `reduce_context`; always ≥ the 32k floor. */
	suggestedContextTokens?: number;
	/** One-line human evidence (the numbers behind the call) — required, so no suggestion is opaque. */
	evidence: string;
	confidence: ContextSizeConfidence;
	/** Compensating mechanisms / caveats to apply alongside the suggestion (never a bare "shrink it"). */
	safetyNotes: string[];
}

/** The advisor's full output for a batch of observations. */
export interface ContextSizeAdvice {
	recommendations: ContextSizeRecommendation[];
	/** One-line roll-up (how many reduce/keep/route across the batch). */
	summary: string;
	/** The floor the advisor will never suggest going below. */
	minContextFloorTokens: number;
}

/** A currently-LOADED model instance (minimal structural shape of `lms ps`) — the loaded-context source. */
export interface LoadedModelContextInput {
	/** The publisher model key (used to join with the perf aggregate's model id). */
	modelKey: string;
	/** Which machine serves this instance (host label for evidence). */
	machineId?: string | null;
	/** The LOADED context length (KV window) for this instance; `null`/absent ⇒ the model is skipped (no window known). */
	contextLength: number | null;
	/** Embedding models have no chat context to advise on — skipped. */
	isEmbedding?: boolean;
}

/** A per-model performance aggregate (minimal structural shape of the telemetry `model`-scope aggregate). */
export interface ModelPerfAggregateInput {
	scope: string;
	modelId: string | null;
	/** Completed+failed runs behind the averages — the sample count. */
	runs: number;
	averageTimeToFirstTokenMs: number | null;
	/** The typical prompt-token usage (average input tokens). */
	averageInputTokens: number | null;
}

/** Loose id normalization for the loaded-model ↔ perf-aggregate join. A mismatch is FAIL-SAFE (⇒ 0 samples ⇒ "keep"). */
function normalizeJoinId(id: string): string {
	return id.trim().toLowerCase();
}

/**
 * Adapt currently-loaded models (`lms ps`) joined with per-model performance aggregates into advisor observations. Pure.
 * Only non-embedding models with a known loaded context are included; a model with no matching perf aggregate is kept
 * with `sampleCount: 0` so the advisor honestly reports "too few samples" rather than silently dropping it.
 */
export function buildContextSizeObservations(input: {
	loadedModels: readonly LoadedModelContextInput[];
	modelPerfAggregates: readonly ModelPerfAggregateInput[];
}): ContextSizeObservation[] {
	const perfById = new Map<string, ModelPerfAggregateInput>();
	for (const aggregate of input.modelPerfAggregates) {
		if (aggregate.scope === "model" && aggregate.modelId) {
			perfById.set(normalizeJoinId(aggregate.modelId), aggregate);
		}
	}
	const observations: ContextSizeObservation[] = [];
	for (const model of input.loadedModels) {
		if (model.isEmbedding || model.contextLength === null || !(model.contextLength > 0)) {
			continue;
		}
		const perf = perfById.get(normalizeJoinId(model.modelKey));
		observations.push({
			modelId: model.modelKey,
			hostId: model.machineId ?? null,
			loadedContextTokens: model.contextLength,
			typicalPromptTokens: perf?.averageInputTokens ?? null,
			peakPromptTokens: null, // aggregates carry the average, not a true peak; the core falls back to typical.
			avgTtftMs: perf?.averageTimeToFirstTokenMs ?? null,
			medianTokensPerSec: null,
			sampleCount: perf?.runs ?? 0,
		});
	}
	return observations;
}

/** Render advice as a compact operator-readable block (for `nklein dev capacity`). Pure. */
export function formatContextSizeAdvice(advice: ContextSizeAdvice): string {
	const lines: string[] = [`Context-size advisor: ${advice.summary}`];
	const actionable = advice.recommendations.filter((r) => r.kind !== "keep");
	if (actionable.length === 0) {
		lines.push("  All loaded models look right-sized (or lack enough samples to advise).");
		return `${lines.join("\n")}\n`;
	}
	for (const rec of actionable) {
		const host = rec.hostId ? ` @ ${rec.hostId}` : "";
		const head =
			rec.kind === "reduce_context"
				? `  ↓ ${rec.modelId}${host}: cap ${rec.loadedContextTokens.toLocaleString("en-US")} → ${(rec.suggestedContextTokens ?? 0).toLocaleString("en-US")} tokens [${rec.confidence}]`
				: `  → ${rec.modelId}${host}: route to a stronger machine [${rec.confidence}]`;
		lines.push(head);
		lines.push(`     ${rec.evidence}`);
		for (const note of rec.safetyNotes) {
			lines.push(`     · ${note}`);
		}
	}
	return `${lines.join("\n")}\n`;
}

/** Standard compensating mechanisms attached to every reduce suggestion (todo §5.AQ: never cut a window bare). */
const REDUCE_SAFETY_NOTES: readonly string[] = [
	"Pair with JIT retrieval (codebase-memory / repo-map) so localization survives a smaller window.",
	"Enable transcript compaction + stable-prefix caching to keep long sessions inside the cap.",
	"Prefer smaller, well-scoped cards so no single task needs the full window.",
	"Route genuinely large-context tasks (peak near/over the cap) to a stronger machine instead of shrinking here.",
];

function confidenceFor(sampleCount: number): ContextSizeConfidence {
	if (sampleCount >= 30) {
		return "high";
	}
	if (sampleCount >= 10) {
		return "medium";
	}
	return "low";
}

/** Round a proposed cap UP to a friendly power-of-two-ish boundary (8k grid), so suggestions read cleanly. */
function roundCapTokens(tokens: number): number {
	const grid = 8192;
	return Math.ceil(tokens / grid) * grid;
}

function fmt(n: number): string {
	return n.toLocaleString("en-US");
}

/**
 * Decide the context-size recommendation for ONE observation. Pure. Order matters: the disqualifiers (too few samples,
 * unknown usage, at/below floor, overflow, well-used) run before the reduce path so the reason names the first that applies.
 */
export function recommendContextSizeForObservation(
	observation: ContextSizeObservation,
	minContextFloorTokens: number = MIN_CONTEXT_FLOOR_TOKENS,
): ContextSizeRecommendation {
	const { modelId, hostId, loadedContextTokens } = observation;
	const base = { modelId, hostId: hostId ?? null, loadedContextTokens } as const;
	const typical = observation.typicalPromptTokens;
	const hostLabel = hostId ? ` on ${hostId}` : "";

	// Too few samples ⇒ never advise on thin evidence.
	if (observation.sampleCount < MIN_SAMPLES_FOR_RECOMMENDATION) {
		return {
			...base,
			kind: "keep",
			evidence: `Only ${observation.sampleCount} timing sample(s)${hostLabel} — too few to advise (need ≥ ${MIN_SAMPLES_FOR_RECOMMENDATION}).`,
			confidence: "low",
			safetyNotes: [],
		};
	}

	// Unknown usage ⇒ can't judge waste.
	if (typical === null || typical === undefined || !(typical > 0)) {
		return {
			...base,
			kind: "keep",
			evidence: `No prompt-token usage recorded for ${modelId}${hostLabel} — cannot judge whether the ${fmt(loadedContextTokens)}-token window is wasted.`,
			confidence: confidenceFor(observation.sampleCount),
			safetyNotes: [],
		};
	}

	const peak =
		observation.peakPromptTokens && observation.peakPromptTokens > typical ? observation.peakPromptTokens : typical;

	// Peak usage overflows the loaded window ⇒ the window is too SMALL, not too big.
	if (peak >= loadedContextTokens) {
		return {
			...base,
			kind: "route_to_stronger_machine",
			evidence: `Peak prompt ${fmt(peak)} tokens meets/exceeds the ${fmt(loadedContextTokens)}-token loaded window${hostLabel} — the window is a bottleneck, not bloat.`,
			confidence: confidenceFor(observation.sampleCount),
			safetyNotes: ["Raise this model's loaded context, or route these large-context tasks to a stronger machine."],
		};
	}

	const utilization = typical / loadedContextTokens;
	const ttft = observation.avgTtftMs ?? null;
	const slowPrefill = ttft !== null && ttft >= SLOW_TTFT_MS;
	const speedNote =
		ttft !== null
			? `avg prefill ${fmt(Math.round(ttft))}ms${observation.medianTokensPerSec ? ` · ${fmt(Math.round(observation.medianTokensPerSec))} tok/s decode` : ""}`
			: "no prefill timing";

	// Well-used window ⇒ keep. If it is also slow, the fix is a stronger machine, not a cut.
	if (utilization >= WELL_USED_UTILIZATION) {
		if (slowPrefill) {
			return {
				...base,
				kind: "route_to_stronger_machine",
				evidence: `Window is well used (${Math.round(utilization * 100)}% — typical ${fmt(typical)} of ${fmt(loadedContextTokens)}) but prefill is slow (${speedNote})${hostLabel}: large-and-necessary, so route these tasks to a stronger machine rather than shrink.`,
				confidence: confidenceFor(observation.sampleCount),
				safetyNotes: ["Do NOT cut this window — it carries real task tokens; move the load to a faster box."],
			};
		}
		return {
			...base,
			kind: "keep",
			evidence: `Window is well used (${Math.round(utilization * 100)}% — typical ${fmt(typical)} of ${fmt(loadedContextTokens)})${hostLabel}; not bloated.`,
			confidence: confidenceFor(observation.sampleCount),
			safetyNotes: [],
		};
	}

	// At/below the floor already ⇒ nothing to reduce.
	if (loadedContextTokens <= minContextFloorTokens) {
		return {
			...base,
			kind: "keep",
			evidence: `Loaded window ${fmt(loadedContextTokens)} is already at/below the ${fmt(minContextFloorTokens)}-token floor${hostLabel} — cannot advise lower.`,
			confidence: confidenceFor(observation.sampleCount),
			safetyNotes: [],
		};
	}

	// Over-provisioned AND slow prefill ⇒ the target case: propose a cap toward peak usage + headroom, never below floor.
	const overProvisioned = utilization < OVER_PROVISIONED_UTILIZATION;
	if (overProvisioned && slowPrefill) {
		const proposed = Math.max(minContextFloorTokens, roundCapTokens(peak * CAP_HEADROOM_OVER_PEAK));
		const savingsRatio = (loadedContextTokens - proposed) / loadedContextTokens;
		if (proposed < loadedContextTokens && savingsRatio >= MIN_SAVINGS_RATIO) {
			const powerNote = observation.lowPowerMode ? " (low-power host — prefill cost is amplified)" : "";
			return {
				...base,
				kind: "reduce_context",
				suggestedContextTokens: proposed,
				evidence: `Loaded ${fmt(loadedContextTokens)} but typical prompt only ${fmt(typical)} (peak ${fmt(peak)}) — ${Math.round((1 - utilization) * 100)}% of the window is unused KV, and prefill is slow (${speedNote})${powerNote}. Capping to ${fmt(proposed)} frees ~${Math.round(savingsRatio * 100)}% of the window while keeping ${CAP_HEADROOM_OVER_PEAK}× headroom over peak use.`,
				confidence: confidenceFor(observation.sampleCount),
				safetyNotes: [...REDUCE_SAFETY_NOTES],
			};
		}
	}

	// Over-provisioned but prefill is NOT slow ⇒ the waste isn't hurting; keep (note it).
	return {
		...base,
		kind: "keep",
		evidence: overProvisioned
			? `Window is over-provisioned (${Math.round(utilization * 100)}% used) but prefill is acceptable (${speedNote})${hostLabel} — no reduce needed.`
			: `Window utilization ${Math.round(utilization * 100)}%${hostLabel}; no clear waste to cut.`,
		confidence: confidenceFor(observation.sampleCount),
		safetyNotes: [],
	};
}

/**
 * Advise over a batch of observations. Pure. Returns per-observation recommendations (most-actionable first: reduce, then
 * route, then keep) plus a one-line summary and the floor. Deterministic order: by kind priority, then by savings desc.
 */
export function adviseContextSizes(
	observations: readonly ContextSizeObservation[],
	minContextFloorTokens: number = MIN_CONTEXT_FLOOR_TOKENS,
): ContextSizeAdvice {
	const recommendations = observations.map((observation) =>
		recommendContextSizeForObservation(observation, minContextFloorTokens),
	);
	const kindRank: Record<ContextSizeRecommendationKind, number> = {
		reduce_context: 0,
		route_to_stronger_machine: 1,
		keep: 2,
	};
	const sorted = [...recommendations].sort((a, b) => {
		if (kindRank[a.kind] !== kindRank[b.kind]) {
			return kindRank[a.kind] - kindRank[b.kind];
		}
		// Within reduce, biggest savings first; otherwise stable by modelId.
		const aSaved = a.suggestedContextTokens ? a.loadedContextTokens - a.suggestedContextTokens : 0;
		const bSaved = b.suggestedContextTokens ? b.loadedContextTokens - b.suggestedContextTokens : 0;
		if (aSaved !== bSaved) {
			return bSaved - aSaved;
		}
		return a.modelId.localeCompare(b.modelId);
	});
	const reduce = sorted.filter((r) => r.kind === "reduce_context").length;
	const route = sorted.filter((r) => r.kind === "route_to_stronger_machine").length;
	const keep = sorted.filter((r) => r.kind === "keep").length;
	const summary =
		sorted.length === 0
			? "No model observations to advise on."
			: `${reduce} context-cap suggestion(s), ${route} route-to-stronger, ${keep} keep — across ${sorted.length} model observation(s).`;
	return { recommendations: sorted, summary, minContextFloorTokens };
}

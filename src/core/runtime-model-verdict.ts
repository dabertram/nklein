/**
 * §5.AL RUNTIME model-suitability verdict (pure) — the evidence-based companion to the curated
 * {@link ./model-capability-catalog.ts} catalog. The catalog verdict is hand-authored + applied PRE-FLIGHT (at
 * task-start). This module derives a verdict from what a model ACTUALLY did at runtime — the persisted
 * self-observation signals (above all `model_stalled`: a turn with no tool call AND no text) plus run summaries —
 * so a model that walls *during* a run becomes countable and surfaceable even when the catalog says `unknown`/`warn`.
 *
 * Deliberately PURE: it takes already-read records (the effectful `readSelfObservationEvents` / diagnostics read
 * stays at the call site) and returns a verdict + the evidence behind it. It NEVER mutates the catalog — the loop
 * is "surface, let the operator confirm" (a provisional entry to promote into `MODEL_CAPABILITY_CATALOG`), never a
 * silent auto-write. Mirrors the {@link ToolUseVerdict} vocabulary so the two sources blend in §5.AB selection.
 */

import type { SelfObservationEventRecord, SelfObservationSignal } from "../telemetry/self-observation-sink.js";
import type { ToolUseVerdict } from "./model-capability-catalog.js";
import { normalizeModelId } from "./model-identity.js";

/** The self-observation signals that count as runtime evidence of a tool-use/agentic difficulty (negative signals). */
export const RUNTIME_DIFFICULTY_SIGNALS = [
	"model_stalled",
	"tool_argument_error",
	"verification_failed",
	"task_abandoned",
] as const satisfies readonly SelfObservationSignal[];

export type RuntimeDifficultySignal = (typeof RUNTIME_DIFFICULTY_SIGNALS)[number];

/** Confidence in a runtime verdict — a direct function of how much evidence (distinct runs) backs it. */
export type RuntimeVerdictConfidence = "low" | "medium" | "high";

/** A minimal shape of the fields this module reads off a run summary (so callers needn't import the full contract). */
export interface RuntimeRunOutcome {
	runId?: string | null;
	modelId?: string | null;
	/** A terminal-but-unsuccessful state is weak evidence; `awaiting_review` is neutral here (success is judged elsewhere). */
	state?: "awaiting_review" | "failed" | "interrupted" | string | null;
}

export interface AssessRuntimeModelVerdictInput {
	/** The model whose runtime behaviour we are assessing (matched against event/run `modelId`, normalized). */
	modelId: string;
	/** Persisted self-observation events (any set; this module filters to `modelId` itself). */
	events: readonly SelfObservationEventRecord[];
	/** OPTIONAL run summaries — used only to widen the sample count (how many runs this model actually drove). */
	runs?: readonly RuntimeRunOutcome[];
}

export interface RuntimeModelVerdict {
	modelId: string;
	/** The evidence-derived tool-use verdict (or `UNKNOWN` when there isn't enough evidence yet). */
	verdict: ToolUseVerdict;
	confidence: RuntimeVerdictConfidence;
	/** How many distinct runs back this verdict (distinct runIds across events + runs; falls back to event count). */
	sampleCount: number;
	/** Count per difficulty signal observed for this model (always lists every {@link RUNTIME_DIFFICULTY_SIGNALS} key). */
	signalCounts: Record<RuntimeDifficultySignal, number>;
	/** Stalls ÷ sampleCount in [0,1] — the headline rate (empty turns are the strongest unsuitability signal). */
	stallRate: number;
	/** Inspectable one-line justification (operator-facing). */
	reason: string;
}

/** Below this many distinct runs we don't pronounce a negative verdict — too little evidence (stays `UNKNOWN`). */
export const MIN_RUNS_FOR_VERDICT = 3;
/** At/above this stall rate the model chronically produces empty turns ⇒ unsuitable for agentic tool chains. */
export const UNSUITABLE_STALL_RATE = 0.5;
/** At/above this stall rate (or with repeated tool-arg errors) the model is weak but not hopeless. */
export const WEAK_STALL_RATE = 0.2;
/** Repeated malformed tool-args at/above this count is itself a weak-tool-use signal independent of stalls. */
export const WEAK_TOOL_ARG_ERRORS = 3;

function confidenceForSamples(sampleCount: number): RuntimeVerdictConfidence {
	if (sampleCount >= 10) {
		return "high";
	}
	if (sampleCount >= MIN_RUNS_FOR_VERDICT) {
		return "medium";
	}
	return "low";
}

/**
 * Derive a runtime suitability verdict for one model from its persisted evidence (pure). Conservative by design:
 * with fewer than {@link MIN_RUNS_FOR_VERDICT} runs it reports `UNKNOWN` (low confidence) rather than condemn a model
 * on noise. Otherwise: a stall rate ≥ {@link UNSUITABLE_STALL_RATE} ⇒ `TOOL_UNSUITABLE`; ≥ {@link WEAK_STALL_RATE}
 * (or ≥ {@link WEAK_TOOL_ARG_ERRORS} malformed-tool-arg events) ⇒ `TOOL_WEAK`; otherwise `TOOL_CAPABLE` (it behaved).
 */
export function assessRuntimeModelVerdict(input: AssessRuntimeModelVerdictInput): RuntimeModelVerdict {
	const target = normalizeModelId(input.modelId);
	const matches = (id: string | null | undefined): boolean =>
		typeof id === "string" && normalizeModelId(id) === target;

	const ourEvents = input.events.filter((event) => matches(event.modelId));
	const signalCounts = Object.fromEntries(RUNTIME_DIFFICULTY_SIGNALS.map((signal) => [signal, 0])) as Record<
		RuntimeDifficultySignal,
		number
	>;
	const runIds = new Set<string>();
	const stalledRunIds = new Set<string>();
	let stallEventsWithoutRunId = 0;
	for (const event of ourEvents) {
		if ((RUNTIME_DIFFICULTY_SIGNALS as readonly string[]).includes(event.signal)) {
			signalCounts[event.signal as RuntimeDifficultySignal] += 1;
		}
		if (typeof event.runId === "string" && event.runId.length > 0) {
			runIds.add(event.runId);
			if (event.signal === "model_stalled") {
				stalledRunIds.add(event.runId);
			}
		} else if (event.signal === "model_stalled") {
			// A stall with no runId can't be deduped to a run — count it directly. Self-observation events currently never
			// carry a runId, so WITHOUT this the deduped `stalledRunIds` is empty and a chronic staller (whose runs come
			// from the ledger `runs` list) is mis-judged TOOL_CAPABLE (stallRate structurally 0).
			stallEventsWithoutRunId += 1;
		}
	}
	for (const run of input.runs ?? []) {
		if (matches(run.modelId) && typeof run.runId === "string" && run.runId.length > 0) {
			runIds.add(run.runId);
		}
	}

	// Sample count = the DISTINCT runs we have run-id evidence for (from the events' runIds + the ledger `runs` list). The
	// fallback must NOT be the failure-event count: self-observation events fire only on FAILURES + never on clean runs,
	// so counting them as "runs" inflates the failure fraction (a capable model with a few stalls then looks chronically
	// unsuitable). With no run-id evidence at all we have no honest denominator ⇒ 0 samples ⇒ UNKNOWN below.
	const sampleCount = runIds.size;
	// Distinct stalled RUNS (dedup when runIds are present — one run with several empty turns counts once) PLUS stalls
	// that carried no runId (can't be deduped), capped at the sample count so the rate stays in [0,1].
	const stalledCount = Math.min(sampleCount, stalledRunIds.size + stallEventsWithoutRunId);
	const stallRate = sampleCount > 0 ? stalledCount / sampleCount : 0;
	const confidence = confidenceForSamples(sampleCount);

	if (sampleCount < MIN_RUNS_FOR_VERDICT) {
		return {
			modelId: input.modelId,
			verdict: "UNKNOWN",
			confidence,
			sampleCount,
			signalCounts,
			stallRate,
			reason:
				sampleCount === 0
					? "No runtime evidence recorded for this model yet."
					: `Only ${sampleCount} run(s) of runtime evidence — too few to pronounce a verdict (need ≥${MIN_RUNS_FOR_VERDICT}).`,
		};
	}

	let verdict: ToolUseVerdict;
	let reason: string;
	if (stallRate >= UNSUITABLE_STALL_RATE) {
		verdict = "TOOL_UNSUITABLE";
		reason = `Stalled (empty turn) on ${stalledCount}/${sampleCount} runs (${Math.round(stallRate * 100)}%) — chronically fails to act.`;
	} else if (stallRate >= WEAK_STALL_RATE || signalCounts.tool_argument_error >= WEAK_TOOL_ARG_ERRORS) {
		verdict = "TOOL_WEAK";
		reason =
			stallRate >= WEAK_STALL_RATE
				? `Stalled on ${stalledCount}/${sampleCount} runs (${Math.round(stallRate * 100)}%) — unreliable but not hopeless.`
				: `${signalCounts.tool_argument_error} malformed tool-arg events across ${sampleCount} runs — weak tool use.`;
	} else {
		verdict = "TOOL_CAPABLE";
		reason = `Behaved across ${sampleCount} runs (stall rate ${Math.round(stallRate * 100)}%) — no chronic runtime difficulty.`;
	}

	return { modelId: input.modelId, verdict, confidence, sampleCount, signalCounts, stallRate, reason };
}

/** Ordering of verdicts from worst→best for "take the more conservative" merges (`UNKNOWN` excluded — it's no-signal). */
const VERDICT_RANK: Record<Exclude<ToolUseVerdict, "UNKNOWN">, number> = {
	TOOL_UNSUITABLE: 0,
	TOOL_WEAK: 1,
	TOOL_CAPABLE: 2,
	TOOL_NATIVE: 3,
};

/** How the curated catalog verdict and the runtime-evidence verdict relate — drives the operator surface (§5.AG/§5.AL). */
export type CombinedSuitabilityFlag =
	/** Both sources agree (or the runtime simply confirms the catalog). */
	| "agree"
	/** The catalog is `UNKNOWN` but runtime evidence gives a verdict — suggest a PROVISIONAL catalog entry to confirm. */
	| "runtime_fills_unknown"
	/** Runtime evidence is materially worse/better than the catalog says — investigate + reconcile the catalog. */
	| "runtime_contradicts_catalog"
	/** Not enough runtime evidence yet — the catalog verdict stands. */
	| "insufficient_runtime_evidence";

export interface CombinedSuitability {
	modelId: string;
	/** The curated, pre-flight catalog verdict (from `lookupModelCapability`); `UNKNOWN` when uncatalogued. */
	catalogVerdict: ToolUseVerdict;
	/** The evidence-derived runtime verdict. */
	runtime: RuntimeModelVerdict;
	/** The blended recommendation (conservative on a contradiction; runtime fills an `UNKNOWN` catalog). */
	recommended: ToolUseVerdict;
	flag: CombinedSuitabilityFlag;
	note: string;
}

/**
 * Blend the curated catalog verdict with the runtime-evidence verdict (pure) — the §5.AL "surface, don't auto-write"
 * feedback step. With insufficient runtime evidence the catalog stands. When the catalog is `UNKNOWN`, runtime fills it
 * (and we flag a provisional entry to confirm). When both have a verdict and they DISAGREE on the suitability ladder,
 * take the more CONSERVATIVE (worse) one and flag it for the operator to reconcile the catalog. Never mutates anything.
 */
export function combineSuitabilityVerdicts(
	catalogVerdict: ToolUseVerdict,
	runtime: RuntimeModelVerdict,
): CombinedSuitability {
	const base = { modelId: runtime.modelId, catalogVerdict, runtime };

	if (runtime.verdict === "UNKNOWN") {
		return {
			...base,
			recommended: catalogVerdict,
			flag: "insufficient_runtime_evidence",
			note: `Catalog says ${catalogVerdict}; ${runtime.reason}`,
		};
	}
	if (catalogVerdict === "UNKNOWN") {
		return {
			...base,
			recommended: runtime.verdict,
			flag: "runtime_fills_unknown",
			note: `Uncatalogued — runtime evidence suggests ${runtime.verdict} (${runtime.sampleCount} run(s)). Confirm a provisional catalog entry.`,
		};
	}
	// Runtime evidence tops out at TOOL_CAPABLE (no signal distinguishes NATIVE from CAPABLE), so collapse NATIVE→CAPABLE
	// when comparing — otherwise every catalogued-NATIVE model would perpetually "contradict" once it logs clean runs.
	const positiveFloor = (verdict: ToolUseVerdict): ToolUseVerdict =>
		verdict === "TOOL_NATIVE" ? "TOOL_CAPABLE" : verdict;
	if (positiveFloor(catalogVerdict) !== positiveFloor(runtime.verdict)) {
		const recommended =
			VERDICT_RANK[catalogVerdict] <= VERDICT_RANK[runtime.verdict] ? catalogVerdict : runtime.verdict;
		return {
			...base,
			recommended,
			flag: "runtime_contradicts_catalog",
			note: `Catalog ${catalogVerdict} vs runtime ${runtime.verdict} (${runtime.sampleCount} run(s)) — using the more conservative ${recommended}; reconcile the catalog.`,
		};
	}
	// Agree on the suitability axis — keep the catalog's (possibly more specific, e.g. NATIVE) verdict, runtime confirms it.
	return {
		...base,
		recommended: catalogVerdict,
		flag: "agree",
		note: `Catalog and runtime agree (${catalogVerdict}${catalogVerdict === runtime.verdict ? "" : ` / runtime ${runtime.verdict}`}, ${runtime.sampleCount} run(s)).`,
	};
}

/** Fitness multipliers applied per runtime verdict — the §5.AB lever that lets runtime EVIDENCE de-prioritize a model. */
export interface RuntimeVerdictFitnessPenalty {
	/** Multiplier for a `TOOL_UNSUITABLE` runtime verdict (chronic stalls) — strongly de-prioritize. Default 0.1. */
	unsuitable?: number;
	/** Multiplier for a `TOOL_WEAK` runtime verdict — moderately de-prioritize. Default 0.5. */
	weak?: number;
}

const DEFAULT_RUNTIME_VERDICT_PENALTY: Required<RuntimeVerdictFitnessPenalty> = { unsuitable: 0.1, weak: 0.5 };

/**
 * §5.AB blend (pure, decoupled): re-weight a fitness-ranked model list by each model's RUNTIME verdict, so accumulated
 * evidence — not just the curated catalog — actually steers selection away from a model that stalls/misbehaves in
 * practice. Generic over any `{ modelId, fitnessScore }` row (mirrors `pruneDistractors`); `TOOL_UNSUITABLE`/`TOOL_WEAK`
 * runtime verdicts scale the score down, everything else (CAPABLE/NATIVE/UNKNOWN/absent) is unchanged. Returns a NEW
 * array re-sorted by the adjusted score (desc), stable on ties. **ID alignment is the CALLER's concern** — it supplies
 * `verdictByModelId` keyed to match each row's `modelId` (e.g. both bare, or both the registry key), keeping this core
 * free of the bare-vs-composite-id question. Never mutates the input rows.
 */
export function penalizeFitnessByRuntimeVerdict<T extends { modelId: string; fitnessScore: number }>(
	ranked: readonly T[],
	verdictByModelId: ReadonlyMap<string, ToolUseVerdict>,
	options: RuntimeVerdictFitnessPenalty = {},
): T[] {
	const unsuitable = options.unsuitable ?? DEFAULT_RUNTIME_VERDICT_PENALTY.unsuitable;
	const weak = options.weak ?? DEFAULT_RUNTIME_VERDICT_PENALTY.weak;
	const adjusted = ranked.map((row, index) => {
		const verdict = verdictByModelId.get(row.modelId);
		const multiplier = verdict === "TOOL_UNSUITABLE" ? unsuitable : verdict === "TOOL_WEAK" ? weak : 1;
		return { row: { ...row, fitnessScore: row.fitnessScore * multiplier }, index };
	});
	adjusted.sort((left, right) => right.row.fitnessScore - left.row.fitnessScore || left.index - right.index);
	return adjusted.map((entry) => entry.row);
}

/** One flagged model for the §5.AG selector badge (§10c#11): the penalty made visible at pick time. */
export interface ModelVerdictBadge {
	modelId: string;
	verdict: Extract<ToolUseVerdict, "TOOL_WEAK" | "TOOL_UNSUITABLE">;
	/** Compact operator-facing label, e.g. `"stalled 3× · tool-weak"`. */
	label: string;
	sampleCount: number;
}

/**
 * Derive the selector-badge list from persisted evidence (pure): one entry per model whose RUNTIME verdict is
 * degraded (TOOL_WEAK / TOOL_UNSUITABLE) at medium+ confidence — low-confidence negatives stay unbadged so a model
 * is never publicly flagged on noise (mirrors {@link MIN_RUNS_FOR_VERDICT}). Sorted worst-first (unsuitable before
 * weak, then by stall count desc, then id). The §10c#11 decision: badge ONLY — no confirm-flow UI.
 */
export function buildModelVerdictBadges(input: {
	events: readonly SelfObservationEventRecord[];
	runs?: readonly RuntimeRunOutcome[];
}): ModelVerdictBadge[] {
	const modelIds = [
		...new Set(
			[...input.events.map((event) => event.modelId), ...(input.runs ?? []).map((run) => run.modelId)].filter(
				(id): id is string => typeof id === "string" && id.trim().length > 0,
			),
		),
	];
	const badges: ModelVerdictBadge[] = [];
	for (const modelId of modelIds) {
		const verdict = assessRuntimeModelVerdict({ modelId, events: input.events, runs: input.runs });
		if (verdict.confidence === "low") {
			continue;
		}
		if (verdict.verdict !== "TOOL_WEAK" && verdict.verdict !== "TOOL_UNSUITABLE") {
			continue;
		}
		const stalls = verdict.signalCounts.model_stalled;
		const parts: string[] = [];
		if (stalls > 0) {
			parts.push(`stalled ${stalls}×`);
		}
		if (verdict.signalCounts.tool_argument_error >= WEAK_TOOL_ARG_ERRORS) {
			parts.push("tool-arg errors");
		}
		parts.push(verdict.verdict === "TOOL_UNSUITABLE" ? "unsuitable" : "tool-weak");
		badges.push({
			modelId,
			verdict: verdict.verdict,
			label: parts.join(" · "),
			sampleCount: verdict.sampleCount,
		});
	}
	badges.sort((left, right) => {
		if (left.verdict !== right.verdict) {
			return left.verdict === "TOOL_UNSUITABLE" ? -1 : 1;
		}
		return right.sampleCount - left.sampleCount || left.modelId.localeCompare(right.modelId);
	});
	return badges;
}

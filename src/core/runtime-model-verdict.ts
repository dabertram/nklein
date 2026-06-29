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
	for (const event of ourEvents) {
		if ((RUNTIME_DIFFICULTY_SIGNALS as readonly string[]).includes(event.signal)) {
			signalCounts[event.signal as RuntimeDifficultySignal] += 1;
		}
		if (typeof event.runId === "string" && event.runId.length > 0) {
			runIds.add(event.runId);
			if (event.signal === "model_stalled") {
				stalledRunIds.add(event.runId);
			}
		}
	}
	for (const run of input.runs ?? []) {
		if (matches(run.modelId) && typeof run.runId === "string" && run.runId.length > 0) {
			runIds.add(run.runId);
		}
	}

	// Sample count = distinct runs we have evidence for; fall back to the raw event count when runIds are absent.
	const sampleCount = runIds.size > 0 ? runIds.size : ourEvents.length;
	// "Stalls" for the RATE = distinct runs that stalled (so one run with several empty turns counts once, keeping the
	// rate in [0,1]); when there are no runIds to dedup against, fall back to the raw stall-event count (≤ event count).
	const stalledCount = runIds.size > 0 ? stalledRunIds.size : signalCounts.model_stalled;
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

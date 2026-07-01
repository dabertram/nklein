/**
 * §5.AB fitness-store FRESHNESS / DECAY + re-eval prioritization (pure). The auto-assigner reads the fitness store to
 * pick a model per (role, difficulty); this module is the policy that keeps that evidence GROUNDED and NEVER STALE
 * (user 2026-06-28): every fitness cell carries a last-measured timestamp + sample count + the live model fingerprint
 * it was measured at (id + loaded context window + quant), and this decider (a) bands each cell's freshness — decaying
 * a thin / old / fingerprint-DRIFTED cell toward `unknown` so assignment can't rest on it — and (b) ranks which
 * (model, role) cells are the most worth RE-EVALUATING next (least-recently / least-confidently measured, or measured
 * at a context/quant a re-loaded model no longer matches), so the §5.AI idle-aware rail can refresh the table for free.
 *
 * WHY a separate wrapper and not fields on {@link ModelFitnessRecord}: the record is the distilled *score* the selector
 * consumes; freshness needs the measurement's TIME + FINGERPRINT, which the score deliberately omits. Carrying them
 * alongside (this `FitnessCell`) keeps the selector record clean while giving the re-eval planner exactly what it needs
 * (the todo's "record carries a last-measured timestamp + fingerprint" requirement), with no edit to the score type.
 *
 * Deliberately PURE + clock-INJECTED (never reads `Date.now()`) + data-injected (cells + the currently-loaded
 * fingerprint are passed in — no store/LM-Studio I/O here), so the policy is fully deterministic + unit-testable; the
 * durable rail (§5.AF/§5.AI) wires the live store read + the idle signal into it.
 */

import type { ModelFitnessRecord } from "./model-fitness.js";

/**
 * The live fingerprint of a model AS CURRENTLY LOADED — the identity a fitness measurement is only valid FOR. A
 * re-loaded model at a different context/quant is effectively a different subject (perf + reasoning quality vary
 * strongly with the loaded window, user 2026-06-28), so a cell measured at a different fingerprint is treated as drifted
 * (→ decayed) rather than reused like-for-like. `quant` is optional because LM Studio does not always expose it.
 */
export interface ModelFitnessFingerprint {
	/** Loaded context window the measurement/model is bound to (tokens). A different loaded window ⇒ drift. */
	contextWindow: number;
	/** Quantization label (e.g. `q4_k_m`, `q8_0`) if known; compared case-insensitively. `undefined` ⇒ ignored. */
	quant?: string;
}

/** One fitness-store cell: a distilled {@link ModelFitnessRecord} plus WHEN + at WHAT fingerprint it was measured. */
export interface FitnessCell {
	record: ModelFitnessRecord;
	/** Epoch ms of the most recent measurement backing this cell. */
	measuredAt: number;
	/** The model fingerprint (loaded context + quant) the measurement was taken at. */
	fingerprint: ModelFitnessFingerprint;
}

/**
 * A cell's freshness band. `unknown` is the DECAYED terminal: an assigner must treat an `unknown` cell as if it had no
 * grounded evidence (fall back to catalog/priors), and the re-eval planner treats it as maximally worth refreshing.
 * `fresh` → trust it; `aging` → usable but due for a refresh; `stale`/`thin`/`drifted` → do not rely on it, re-measure.
 */
export type FitnessFreshness = "fresh" | "aging" | "stale" | "thin" | "drifted" | "unknown";

/** Thresholds + minimums governing the decay bands. Ages are in whole ms; sample counts are raw observation counts. */
export interface FitnessFreshnessPolicy {
	/** Age (ms) at/below which a cell is `fresh`. */
	freshMaxAgeMs: number;
	/** Age (ms) at/below which a cell is at worst `aging`; beyond it a well-sampled cell is `stale`. */
	agingMaxAgeMs: number;
	/**
	 * Minimum samples for a cell to be considered grounded at all. Below this the cell is `thin` (unless a harder band
	 * already applies), regardless of how recent — a single lucky/unlucky run is not evidence.
	 */
	minSamples: number;
	/** Age (ms) beyond which even a well-sampled cell has fully decayed to `unknown` (evidence is too old to trust). */
	decayToUnknownAgeMs: number;
}

/**
 * Conservative defaults. Fitness turns over as LM Studio's loaded set / quant / context change between sessions, so the
 * bands are DAYS-scale, not weeks: a cell older than ~7d fully decays to `unknown`. Tunable — the SHAPE (age + samples +
 * fingerprint → band) is the durable part; the constants ride the §5.AB eval-cadence data once it exists.
 */
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
export const DEFAULT_FITNESS_FRESHNESS_POLICY: FitnessFreshnessPolicy = {
	freshMaxAgeMs: 12 * HOUR_MS,
	agingMaxAgeMs: 2 * DAY_MS,
	minSamples: 3,
	decayToUnknownAgeMs: 7 * DAY_MS,
};

/** True when the cell's measurement fingerprint no longer matches the model as currently loaded (context/quant drift). */
export function fingerprintDrifted(
	measured: ModelFitnessFingerprint,
	live: ModelFitnessFingerprint | undefined,
): boolean {
	if (!live) {
		// No live fingerprint supplied (e.g. the model isn't currently loaded) ⇒ cannot claim drift; not-drifted.
		return false;
	}
	if (measured.contextWindow !== live.contextWindow) {
		return true;
	}
	const a = measured.quant?.trim().toLowerCase();
	const b = live.quant?.trim().toLowerCase();
	// Only a KNOWN-vs-KNOWN mismatch counts as drift; an unknown quant on either side is not evidence of a change.
	return a !== undefined && b !== undefined && a !== b;
}

/**
 * Band a single fitness cell's freshness relative to `now` + the currently-loaded fingerprint. Precedence (hardest
 * first): fully-decayed age → `unknown`; fingerprint drift → `drifted`; too few samples → `thin`; else by age
 * `fresh`/`aging`/`stale`. A future/invalid `measuredAt` (age < 0) is clamped to age 0 (treated as just-measured).
 */
export function judgeFitnessFreshness(
	cell: FitnessCell,
	now: number,
	live?: ModelFitnessFingerprint,
	policy: FitnessFreshnessPolicy = DEFAULT_FITNESS_FRESHNESS_POLICY,
): FitnessFreshness {
	const ageMs = Math.max(0, now - cell.measuredAt);
	if (ageMs >= policy.decayToUnknownAgeMs) {
		return "unknown";
	}
	if (fingerprintDrifted(cell.fingerprint, live)) {
		return "drifted";
	}
	if (cell.record.samples < policy.minSamples) {
		return "thin";
	}
	if (ageMs <= policy.freshMaxAgeMs) {
		return "fresh";
	}
	if (ageMs <= policy.agingMaxAgeMs) {
		return "aging";
	}
	return "stale";
}

/** True when a cell's evidence should NOT be relied on for assignment — i.e. it is due for (re-)measurement. */
export function isFitnessCellReliable(freshness: FitnessFreshness): boolean {
	return freshness === "fresh" || freshness === "aging";
}

/**
 * Re-eval priority in [0, 1] — higher = more worth re-measuring NOW. A monotonic blend of AGE (older → higher),
 * CONFIDENCE gap (fewer samples → higher), and a FINGERPRINT-DRIFT bump (a model re-loaded at a new context/quant is
 * urgently worth re-measuring). Deterministic + bounded so the idle rail can rank cells with a stable total order.
 * `fresh` well-sampled matching cells score near 0; a drifted or fully-decayed cell scores near/at 1.
 */
export function fitnessRefreshPriority(
	cell: FitnessCell,
	now: number,
	live?: ModelFitnessFingerprint,
	policy: FitnessFreshnessPolicy = DEFAULT_FITNESS_FRESHNESS_POLICY,
): number {
	const ageMs = Math.max(0, now - cell.measuredAt);
	// Age component: 0 at age 0, 1 at/after the full decay horizon.
	const ageScore = clamp01(ageMs / policy.decayToUnknownAgeMs);
	// Confidence gap: 1 with zero samples, 0 once the cell has ≥ 2× the minimum (well-grounded). Ramps down linearly.
	const wellSampledAt = Math.max(1, policy.minSamples * 2);
	const confidenceGap = clamp01(1 - cell.record.samples / wellSampledAt);
	// Base blend weights age a little above confidence (an old measurement is the primary staleness signal).
	const base = 0.6 * ageScore + 0.4 * confidenceGap;
	// A drifted fingerprint is a hard reason to re-measure regardless of age/samples — floor the priority high.
	if (fingerprintDrifted(cell.fingerprint, live)) {
		return Math.max(base, 0.9);
	}
	return base;
}

/** A cell keyed for re-eval selection: the underlying cell, its freshness band, and its refresh priority. */
export interface FitnessReevalCandidate {
	cell: FitnessCell;
	freshness: FitnessFreshness;
	priority: number;
}

export interface SelectFitnessReevalInput {
	/** The fitness-store cells under consideration (already scoped to the models the caller cares about). */
	cells: readonly FitnessCell[];
	/** Current time (epoch ms). */
	now: number;
	/**
	 * The live fingerprint per model id — the model AS CURRENTLY LOADED. A cell whose model has an entry here is
	 * fingerprint-checked (drift → re-eval); a cell whose model is absent (not loaded) can't be re-measured now and is
	 * excluded by default (see `includeUnloaded`). The map key must match `record.modelId` exactly (caller normalizes).
	 */
	liveByModelId: ReadonlyMap<string, ModelFitnessFingerprint>;
	/** Max cells to return (the idle-budget for this pass). ≤0 ⇒ none. */
	budget: number;
	policy?: FitnessFreshnessPolicy;
	/**
	 * When true, cells whose model is not in `liveByModelId` (not currently loaded) are still eligible (fingerprint
	 * check skipped). Default false: you can only re-measure a loaded model, so an unloaded cell is not a candidate now.
	 */
	includeUnloaded?: boolean;
}

/**
 * Pick the (model, role) cells most worth RE-EVALUATING next — the idle-aware, budgeted core of the "always-fresh
 * grounded metrics" loop (user 2026-06-28). Considers only cells that are NOT currently reliable (stale/thin/drifted/
 * unknown — a `fresh`/`aging` cell is left alone) and, unless `includeUnloaded`, only cells whose model is loaded (you
 * can't measure an unloaded model). Ranks by `fitnessRefreshPriority` desc; ties break by OLDER `measuredAt`, then by
 * `modelId`+`role` for a stable, deterministic order. Returns at most `budget` candidates, each with its freshness +
 * priority so the caller can log WHY it re-measured.
 */
export function selectFitnessCellsToReeval(input: SelectFitnessReevalInput): FitnessReevalCandidate[] {
	const policy = input.policy ?? DEFAULT_FITNESS_FRESHNESS_POLICY;
	if (input.budget <= 0) {
		return [];
	}
	const candidates: FitnessReevalCandidate[] = [];
	for (const cell of input.cells) {
		const live = input.liveByModelId.get(cell.record.modelId);
		if (live === undefined && !input.includeUnloaded) {
			continue; // Not loaded ⇒ can't re-measure it in this pass.
		}
		const freshness = judgeFitnessFreshness(cell, input.now, live, policy);
		if (isFitnessCellReliable(freshness)) {
			continue; // Already grounded + current ⇒ nothing to refresh.
		}
		candidates.push({
			cell,
			freshness,
			priority: fitnessRefreshPriority(cell, input.now, live, policy),
		});
	}
	candidates.sort((a, b) => {
		if (b.priority !== a.priority) {
			return b.priority - a.priority; // Most urgent first.
		}
		if (a.cell.measuredAt !== b.cell.measuredAt) {
			return a.cell.measuredAt - b.cell.measuredAt; // Older measurement first.
		}
		const byModel = a.cell.record.modelId.localeCompare(b.cell.record.modelId);
		return byModel !== 0 ? byModel : a.cell.record.role.localeCompare(b.cell.record.role);
	});
	return candidates.slice(0, input.budget);
}

function clamp01(value: number): number {
	if (Number.isNaN(value)) {
		return 0;
	}
	return Math.min(1, Math.max(0, value));
}

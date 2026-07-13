/**
 * §5.AB eval-harness COVERAGE planner (pure) — the "which (model, role, difficulty) cell do I probe NEXT to
 * CHARACTERIZE this model?" brain. It is the missing COVERAGE half of the §5.AB "always-fresh grounded metrics" loop:
 * {@link ./model-fitness-freshness.ts} `selectFitnessCellsToReeval` already ranks EXISTING cells by STALENESS/drift, but
 * it is silent on the two cases the harness most needs when it meets a NEW model — a cell that was NEVER measured (a
 * coverage GAP: an unknown model has ZERO cells, so the freshness selector returns nothing), and the efficient ORDER to
 * fill those gaps. This module owns exactly that: given the target eval matrix (the roles × difficulty tiers the corpus
 * spans) and whatever cells already exist, it emits an ORDERED, budget-bounded probe plan to characterize a model with
 * the FEWEST wasted runs.
 *
 * Two harness-faithful pruning rules make the plan efficient rather than a blind cross-product:
 *   1. **Floor-first climb.** Per role, probe the EASIEST unmeasured tier before a harder one — the monotone-climb the
 *      aggregator ({@link ./model-eval-aggregation.ts} `maxDifficultyClearedFrom`) already assumes: a model's ceiling is
 *      found by walking easiest→hardest, so there is no point spending a probe on `hard` before `medium` is established.
 *   2. **Ceiling prune.** If a role ALREADY has a reliably-measured tier the model FAILED, do not probe strictly-HARDER
 *      unmeasured tiers of that role — the aggregator credits nothing past a failed evaluated tier, so those probes are
 *      wasted (a model that flunks `medium` will not be trusted at `hard`). Gaps at/below the known frontier still count.
 *
 * Coverage gaps outrank stale refreshes (an unknown cell has NO evidence, a stale one has decayed evidence), and within
 * the same class the plan is a stable, deterministic total order (role, then tier rank), so the idle rail
 * ({@link ./background-eval-runner.ts}) gets a repeatable "characterize the newcomer, then keep the table fresh" queue.
 *
 * DELIBERATELY DISTINCT from `selectFitnessCellsToReeval`: that selector answers "of the cells I HAVE, which decayed
 * ones should I refresh?"; this planner answers "of the cells I SHOULD have (the target matrix), which are MISSING or
 * decayed, and in what order do I fill them to characterize the model cheaply?". Freshness computes the staleness
 * PRIORITY (reused here for stale cells); coverage computes the matrix GAP + the probe order it cannot.
 *
 * Pure + deterministic + clock-INJECTED (never reads `Date.now()`) + data-injected (existing cells + the loaded
 * fingerprint are passed in — no store / LM-Studio I/O), so the policy is fully unit-testable; the effectful harness
 * wires the live store read + the idle signal + the actual probe execution around it.
 */

import { EVAL_DIFFICULTY_TIERS, type EvalDifficultyTier } from "./model-eval-aggregation.js";
import {
	DEFAULT_FITNESS_FRESHNESS_POLICY,
	type FitnessCell,
	type FitnessFreshnessPolicy,
	fitnessRefreshPriority,
	isFitnessCellReliable,
	judgeFitnessFreshness,
	type ModelFitnessFingerprint,
} from "./model-fitness-freshness.js";
import { SWARM_ROLES } from "./role-model-class.js";

/** Rank (0 = easiest) of each tier — the monotone order the floor-first climb + ceiling prune walk. Local copy so this
 * module owns its ordering without reaching into the aggregator's private rank map (the tier LIST is the shared contract). */
const TIER_RANK: Record<EvalDifficultyTier, number> = {
	trivial: 0,
	easy: 1,
	medium: 2,
	hard: 3,
	"very-hard": 4,
};

/**
 * What a single (role, tier) cell of the TARGET matrix is, for one model, when the plan is computed:
 *   - `unmeasured` — no cell exists yet (a coverage GAP; the highest-value probe, zero prior evidence);
 *   - `stale` — a cell exists but is NOT currently reliable (decayed/thin/drifted per the freshness policy) ⇒ refresh;
 *   - `reliable` — a cell exists and is fresh/aging ⇒ leave it alone (not a probe target);
 *   - `above_ceiling` — an unmeasured cell strictly HARDER than a role tier the model reliably FAILED ⇒ pruned (a
 *     wasted probe under the aggregator's monotone-climb); surfaced (not silently dropped) so the caller can see WHY.
 */
export type EvalCellCoverage = "unmeasured" | "stale" | "reliable" | "above_ceiling";

/** One planned probe: the (role, tier) cell to run, why it is a target, and its scheduling priority in [0, 1]. */
export interface EvalProbe {
	role: string;
	tier: EvalDifficultyTier;
	/** `unmeasured` (a coverage gap) or `stale` (a decayed cell due for refresh) — the two probe-worthy classes. */
	coverage: "unmeasured" | "stale";
	/**
	 * Scheduling priority in [0, 1], higher = probe sooner. A coverage GAP scores in the UNMEASURED band [0.5, 1] (an
	 * easier gap outranks a harder one so the floor is established first); a STALE cell scores in [0, 0.5) from the
	 * freshness policy's {@link fitnessRefreshPriority} (age/confidence/drift), compressed below every gap so
	 * characterizing a model always precedes refreshing it.
	 */
	priority: number;
}

/** The target eval matrix to plan coverage against — the roles × difficulty tiers the corpus is expected to span. */
export interface EvalCoverageMatrix {
	/** Roles to characterize. Defaults to {@link SWARM_ROLES} (architect/worker/reviewer). */
	roles?: readonly string[];
	/** Difficulty tiers to characterize. Defaults to {@link EVAL_DIFFICULTY_TIERS} (trivial→very-hard). */
	tiers?: readonly EvalDifficultyTier[];
}

/**
 * An ALREADY-measured eval cell tagged with the difficulty tier it covers. The §5.AB fitness store keys a
 * {@link FitnessCell} by (model, role) only ({@link ModelFitnessRecord} carries no difficulty — its
 * `maxDifficultyCleared` is the DERIVED ceiling, not the tier the cell was probed AT), so the caller pairs each stored
 * cell with the tier that produced it. That `tier` is the coverage coordinate this planner needs; the wrapped `cell`
 * carries the record + measuredAt + fingerprint the freshness judgment consumes unchanged.
 */
export interface MeasuredEvalCell {
	/** The difficulty tier this measured cell characterizes. */
	tier: EvalDifficultyTier;
	/** The stored fitness cell (record + measuredAt + fingerprint) — reused as-is by the freshness policy. */
	cell: FitnessCell;
}

export interface PlanEvalCoverageInput {
	/** The model whose coverage is being planned (its cells are matched by the wrapped `record.modelId`). */
	modelId: string;
	/** The eval-store cells that ALREADY exist for this model, each tagged with its tier. Other models' cells ignored. */
	existingCells: readonly MeasuredEvalCell[];
	/** Current time (epoch ms) — for the freshness judgment of existing cells. */
	now: number;
	/** The model's live fingerprint (loaded context + quant); drives drift detection in the freshness judgment. */
	live?: ModelFitnessFingerprint;
	/** The target matrix to cover. Omitted axes default to the full corpus (all swarm roles × all tiers). */
	matrix?: EvalCoverageMatrix;
	/** Max probes to return (the idle-budget for this pass). ≤0 ⇒ none. */
	budget: number;
	/** Freshness bands governing when an existing cell counts as reliable vs stale. */
	policy?: FitnessFreshnessPolicy;
}

/** A per-cell coverage classification (every target cell, not just the probe-worthy ones) — for an operator/debug view. */
export interface EvalCellCoverageEntry {
	role: string;
	tier: EvalDifficultyTier;
	coverage: EvalCellCoverage;
}

/**
 * Classify EVERY target-matrix cell for a model — the full coverage map behind {@link planEvalCoverage} (which then
 * ranks + budgets only the probe-worthy `unmeasured`/`stale` cells). Exposed on its own so an operator surface can show
 * the matrix at a glance (what is measured / missing / pruned) without re-deriving it. Deterministic order: role
 * (as given), then tier rank (easiest→hardest).
 *
 * The `above_ceiling` prune is applied per role: find the hardest tier the model has a RELIABLE-and-FAILED cell for
 * (reliably measured, but its record shows it does not clear — `maxDifficultyCleared` below the tier's own score), then
 * mark every UNMEASURED cell strictly harder than that as `above_ceiling`. An already-measured cell keeps its
 * reliable/stale class regardless (we do not re-hide real evidence).
 */
export function classifyEvalCoverage(input: PlanEvalCoverageInput): EvalCellCoverageEntry[] {
	const policy = input.policy ?? DEFAULT_FITNESS_FRESHNESS_POLICY;
	const roles = input.matrix?.roles ?? SWARM_ROLES;
	// Sort the target tiers easiest→hardest (by rank) regardless of the order the caller supplied — the ceiling prune +
	// the floor-first climb both reason in rank order, and a stable easiest→hardest listing is the useful operator view.
	// A caller-supplied non-canonical tier (no rank) sorts last but is still classified.
	const tiers = [...(input.matrix?.tiers ?? EVAL_DIFFICULTY_TIERS)].sort(
		(a, b) => (TIER_RANK[a] ?? Number.POSITIVE_INFINITY) - (TIER_RANK[b] ?? Number.POSITIVE_INFINITY),
	);

	const cellByKey = indexCellsForModel(input.existingCells, input.modelId);

	// Per-role known failure ceiling: the hardest tier RANK the model reliably has evidence for AND does not clear.
	// Below/at this rank we still want gaps filled; strictly ABOVE it, unmeasured cells are pruned (wasted probes).
	const failureCeilingRankByRole = computeFailureCeilingRanks(cellByKey, input.now, input.live, policy);

	const entries: EvalCellCoverageEntry[] = [];
	for (const role of roles) {
		const ceilingRank = failureCeilingRankByRole.get(role);
		for (const tier of tiers) {
			const measured = cellByKey.get(coverageKey(role, tier));
			if (measured) {
				const freshness = judgeFitnessFreshness(measured.cell, input.now, input.live, policy);
				entries.push({ role, tier, coverage: isFitnessCellReliable(freshness) ? "reliable" : "stale" });
				continue;
			}
			// Unmeasured: a coverage gap — unless it sits strictly above a known reliable failure ceiling for the role.
			const prunedByCeiling = ceilingRank !== undefined && TIER_RANK[tier] > ceilingRank;
			entries.push({ role, tier, coverage: prunedByCeiling ? "above_ceiling" : "unmeasured" });
		}
	}
	return entries;
}

/**
 * Plan the ordered set of probes to (re)characterize a model — the COVERAGE-driven "what to evaluate next" queue the
 * staleness selector cannot produce. Coverage gaps come first (an unmeasured cell has no evidence), easiest-tier gaps
 * before harder ones per role (floor-first, so the model's ceiling is found cheaply and the ceiling-prune can then kick
 * in on later passes), and decayed (stale) cells trail behind all gaps ranked by the freshness policy's own priority.
 * Cells pruned as `above_ceiling` are never probed. Returns at most `budget` probes; deterministic ties (priority, then
 * role, then tier rank).
 */
export function planEvalCoverage(input: PlanEvalCoverageInput): EvalProbe[] {
	if (input.budget <= 0) {
		return [];
	}
	const policy = input.policy ?? DEFAULT_FITNESS_FRESHNESS_POLICY;
	const coverage = classifyEvalCoverage(input);
	const cellByKey = indexCellsForModel(input.existingCells, input.modelId);

	const probes: EvalProbe[] = [];
	for (const entry of coverage) {
		if (entry.coverage === "unmeasured") {
			probes.push({
				role: entry.role,
				tier: entry.tier,
				coverage: "unmeasured",
				priority: unmeasuredPriority(entry.tier),
			});
		} else if (entry.coverage === "stale") {
			const measured = cellByKey.get(coverageKey(entry.role, entry.tier));
			// A stale cell always has a backing cell (that is what made it stale); guard defensively regardless.
			const staleness = measured ? fitnessRefreshPriority(measured.cell, input.now, input.live, policy) : 0;
			probes.push({
				role: entry.role,
				tier: entry.tier,
				coverage: "stale",
				// Compress the freshness priority [0,1] into [0, 0.5) — STRICTLY below the hardest gap (which floors at
				// exactly 0.5) so EVERY coverage gap outranks EVERY refresh, even a maximally-decayed/drifted stale cell.
				priority: STALE_BAND_SCALE * clamp01(staleness),
			});
		}
	}

	probes.sort((a, b) => {
		if (b.priority !== a.priority) {
			return b.priority - a.priority; // higher priority first
		}
		const byRole = a.role.localeCompare(b.role);
		if (byRole !== 0) {
			return byRole;
		}
		return TIER_RANK[a.tier] - TIER_RANK[b.tier]; // easier tier first on a tie
	});
	return probes.slice(0, input.budget);
}

/** Lower bound of the UNMEASURED band = upper bound (exclusive) of the STALE band: every gap ≥ this, every refresh <. */
const STALE_BAND_MAX = 0.5;
/** Scale factor mapping a freshness priority [0,1] into [0, STALE_BAND_MAX) — strictly below the hardest gap (0.5). */
const STALE_BAND_SCALE = 0.499;

/**
 * Priority of an UNMEASURED (coverage-gap) cell, in [0.5, 1]: floor-first, so an EASIER gap outranks a harder one and
 * the harness establishes the model's floor before spending probes higher up. Linear over the tier rank: the easiest
 * tier scores 1.0, the hardest scores exactly `STALE_BAND_MAX` (0.5) so even the hardest gap still outranks every stale
 * refresh. Robust to a caller-supplied tier not in the canonical set (treated as mid-rank, still inside the band).
 */
function unmeasuredPriority(tier: EvalDifficultyTier): number {
	const maxRank = EVAL_DIFFICULTY_TIERS.length - 1; // 4 for trivial..very-hard
	const rank = TIER_RANK[tier] ?? Math.floor(maxRank / 2);
	const eased = maxRank > 0 ? rank / maxRank : 0; // 0 (easiest) .. 1 (hardest)
	return 1 - eased * (1 - STALE_BAND_MAX); // easiest → 1.0, hardest → 0.5
}

/**
 * Per-role hardest tier RANK the model reliably has evidence for AND does not clear — the failure ceiling above which
 * unmeasured cells are pruned. A cell contributes only when it is currently RELIABLE (fresh/aging — we don't prune from
 * decayed evidence) AND its record does NOT clear its own tier (the tier's difficulty score exceeds the record's
 * `maxDifficultyCleared`). Roles with no such cell are absent from the map (no ceiling ⇒ nothing pruned).
 */
function computeFailureCeilingRanks(
	cellByKey: ReadonlyMap<string, MeasuredEvalCell>,
	now: number,
	live: ModelFitnessFingerprint | undefined,
	policy: FitnessFreshnessPolicy,
): Map<string, number> {
	const ceiling = new Map<string, number>();
	for (const { tier, cell } of cellByKey.values()) {
		const rank = TIER_RANK[tier];
		if (rank === undefined) {
			continue; // a non-canonical tier can't anchor the monotone ceiling
		}
		if (!isFitnessCellReliable(judgeFitnessFreshness(cell, now, live, policy))) {
			continue; // don't prune based on decayed evidence
		}
		// Does this reliable cell FAIL its own tier? The tier's own difficulty is TIER_RANK-aligned with the record's
		// 0..1 `maxDifficultyCleared`; a record that clears BELOW this tier's difficulty is a reliable failure here.
		if (!clearsTier(cell.record.maxDifficultyCleared, tier)) {
			const role = cell.record.role;
			const prev = ceiling.get(role);
			ceiling.set(role, prev === undefined ? rank : Math.max(prev, rank));
		}
	}
	return ceiling;
}

/**
 * Index a model's measured cells by (role, tier) for O(1) coverage lookup — dropping cells for OTHER models and keying
 * on the WRAPPER's `tier` (the coverage coordinate) with the cell's own `record.role`. A duplicate (role, tier) keeps
 * the LAST occurrence (the caller is expected to pass at most one measured cell per matrix coordinate).
 */
function indexCellsForModel(cells: readonly MeasuredEvalCell[], modelId: string): Map<string, MeasuredEvalCell> {
	const byKey = new Map<string, MeasuredEvalCell>();
	for (const measured of cells) {
		if (measured.cell.record.modelId === modelId) {
			byKey.set(coverageKey(measured.cell.record.role, measured.tier), measured);
		}
	}
	return byKey;
}

/**
 * The 0..1 difficulty each tier represents on the `maxDifficultyCleared` axis — a LOCAL copy of the aggregator's
 * `DIFFICULTY_TIER_SCORE` so this module owns its ceiling arithmetic against the same shared tier ladder without
 * importing a value that could drift its meaning. Kept in lock-step with {@link ./model-eval-aggregation.ts}.
 */
const TIER_DIFFICULTY: Record<EvalDifficultyTier, number> = {
	trivial: 0.1,
	easy: 0.3,
	medium: 0.55,
	hard: 0.8,
	"very-hard": 1,
};

/** True when a record's reliably-cleared ceiling reaches the given tier's difficulty (i.e. the model clears the tier). */
function clearsTier(maxDifficultyCleared: number, tier: EvalDifficultyTier): boolean {
	return maxDifficultyCleared >= TIER_DIFFICULTY[tier];
}

const COVERAGE_KEY_SEP = "\u0000";

function coverageKey(role: string, tier: string): string {
	return `${role}${COVERAGE_KEY_SEP}${tier}`;
}

function clamp01(value: number): number {
	if (Number.isNaN(value)) {
		return 0;
	}
	return Math.min(1, Math.max(0, value));
}

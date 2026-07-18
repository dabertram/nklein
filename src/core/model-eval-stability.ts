/**
 * §5.AB EVAL-STABILITY / confidence scorer (pure) — is a model's per-cell eval verdict SETTLED or still FLAKY? The
 * §5.AB harness repeats each (model, role, difficulty) cell N× for stochastic stability, and
 * {@link ./model-eval-aggregation.ts} folds those repeats into a `reliability` = the cell's pass-RATE at the ceiling.
 * But a pass-rate is a POINT estimate: it says nothing about whether that number is TRUSTWORTHY. A cell measured at
 * exactly the reliability bar over 4 runs, and a cell far above it over 20, both surface the same "cleared" bit — yet
 * the first is a coin-flip that a couple more runs could flip, and the second is a decisive verdict. This module is the
 * missing STABILITY judgment on top of the aggregation: per cell it decides `settled_pass` / `settled_fail` / `flaky` /
 * `thin`, and computes HOW MANY more runs are owed to settle an unsettled cell — the actionable signal an idle re-eval
 * rail needs to spend its budget on cells whose verdict is genuinely in doubt, not on cells that are already decisive.
 *
 * WHY a `flaky` verdict is not just "pass-rate near the bar": a cell can PASS every run yet swing wildly in graded
 * QUALITY run-to-run (0.95, 0.40, 0.92, 0.38 …). Its pass-rate is a clean 1.0, but the model is clearly UNSTABLE on that
 * work — a real intermittency the pass-rate alone hides. So this scorer treats a cell as `flaky` when EITHER (a) its
 * pass-rate sits inside a margin band around the reliability bar (decisively neither cleared nor failed), OR (b) its
 * graded-quality SPREAD across the repeats exceeds a threshold (high run-to-run variance) — both are "don't trust this
 * yet, settle it with more runs" signals. A cell is `settled_pass` / `settled_fail` only when it is BOTH well-sampled
 * AND decisively on one side of the bar AND low-spread.
 *
 * DELIBERATELY DISTINCT from its neighbours (composes them, duplicates none):
 *   - {@link ./model-eval-aggregation.ts} produces the pass-rate + `cleared` bit (reused here via
 *     `summarizeModelEvalCells`); it does NOT judge whether that bit is decisive or a coin-flip, nor count owed runs.
 *   - {@link ./model-eval-coverage-plan.ts} answers "which MISSING cell do I probe to CHARACTERIZE a model?" (fills
 *     matrix GAPS); this answers the orthogonal "which MEASURED cell is too UNSETTLED to trust, and how many more runs
 *     settle it?" (re-runs BORDERLINE cells). Coverage finds the unknown; stability settles the known-but-shaky.
 *   - {@link ./flake-quarantine.ts} scores a TEST's flakiness over its pass/fail history (§5.AI dev-test rail); this
 *     scores a MODEL's eval-verdict stability over the graded eval-run matrix (§5.AB). Different subject entirely.
 *
 * Pure + deterministic (no clock, no store, no I/O — the graded runs are INJECTED), so the whole stability judgment is
 * unit-testable; the effectful harness/rail wires the live run stream + the idle budget around it.
 */

import {
	type AggregateModelEvalPolicy,
	DEFAULT_AGGREGATE_MODEL_EVAL_POLICY,
	type EvalDifficultyTier,
	type ModelEvalCellSummary,
	type ModelEvalRun,
	summarizeModelEvalCells,
} from "./model-eval-aggregation.js";

/** Rank (0 = easiest) of each tier — the tie-break order for a deterministic worst-first listing. */
const TIER_RANK: Record<EvalDifficultyTier, number> = {
	trivial: 0,
	easy: 1,
	medium: 2,
	hard: 3,
	"very-hard": 4,
};

/**
 * A cell's stability verdict — how much to TRUST its aggregated pass/quality signal:
 *   - `settled_pass` — well-sampled, pass-rate decisively ABOVE the reliability bar, low quality spread ⇒ trust it clears;
 *   - `settled_fail` — well-sampled, pass-rate decisively BELOW the fail floor, low quality spread ⇒ trust it does NOT clear;
 *   - `flaky` — well-sampled but UNSETTLED: pass-rate inside the margin band around the bar, OR high run-to-run quality
 *     spread (intermittent even if the pass-rate looks clean) ⇒ verdict in doubt, owe more runs;
 *   - `thin` — too few runs to pronounce any verdict at all (a single lucky/unlucky run is not evidence) ⇒ owe more runs.
 */
export type EvalStabilityVerdict = "settled_pass" | "settled_fail" | "flaky" | "thin";

/** Tunables for the stability judgment. All 0..1 scalars except `minSettledRuns` (a raw run count). */
export interface EvalStabilityPolicy {
	/**
	 * Minimum runs before a cell can be anything but `thin`. Below this there is not enough evidence to call a verdict
	 * settled OR flaky. Default 4 (two repeats is enough to AGGREGATE a pass-rate, but settling a verdict wants more).
	 */
	minSettledRuns: number;
	/**
	 * Target run count a `thin` / `flaky` cell should reach to be trusted — the owed-runs are computed to bring an
	 * unsettled cell UP to this. Must be ≥ `minSettledRuns`; a lower value is raised to it. Default 6.
	 */
	targetSettledRuns: number;
	/**
	 * Half-width of the margin BAND around the reliability bar inside which a pass-rate is "too close to call". A cell
	 * clears decisively only at `passRate ≥ bar + margin`; fails decisively only at `passRate ≤ bar − margin`; anything
	 * strictly between is `flaky`. In [0, 1]. Default 0.15.
	 */
	passRateMargin: number;
	/**
	 * Max graded-quality SPREAD (max − min across the cell's runs) a cell may have and still be `settled`. Above this the
	 * cell is `flaky` regardless of its pass-rate (high run-to-run quality variance ⇒ intermittent). In [0, 1]. Default 0.4.
	 */
	maxSettledQualitySpread: number;
}

export const DEFAULT_EVAL_STABILITY_POLICY: EvalStabilityPolicy = {
	minSettledRuns: 4,
	targetSettledRuns: 6,
	passRateMargin: 0.15,
	maxSettledQualitySpread: 0.4,
};

/** One cell's stability judgment — its verdict, the confidence behind it, the spread that drove it, and owed runs. */
/**
 * F12.43 — the pass^k reliability view of a cell: pass@1 is blind to consistency (70% pass@1 ⇒ pass^3 ≈ 34%),
 * so the sweep reports the probability ALL k independent runs pass, both as the plug-in estimate and from the
 * Wilson lower bound (the honest small-n floor). Cross-run variance is the sibling `qualitySpread`; the
 * Meltdown-Onset entropy signal for long tasks needs logprob capture and stays a named remainder.
 */
export interface PassPowerK {
	k: number;
	/** (successes/runs)^k — the plug-in estimate. */
	estimate: number;
	/** Wilson 95% interval on the per-run pass rate. */
	wilsonLower: number;
	wilsonUpper: number;
	/** wilsonLower^k — the conservative all-k-pass floor routing should trust at small n. */
	lowerBoundPowerK: number;
}

/** Wilson score interval (95%) + pass^k for s successes over n runs. Pure; n ≤ 0 ⇒ zeros. */
export function computePassPowerK(successes: number, runs: number, k = 3): PassPowerK {
	const n = Math.max(0, Math.trunc(runs));
	const s = Math.max(0, Math.min(n, Math.trunc(successes)));
	const kk = Math.max(1, Math.trunc(k));
	if (n === 0) {
		return { k: kk, estimate: 0, wilsonLower: 0, wilsonUpper: 0, lowerBoundPowerK: 0 };
	}
	const z = 1.959964; // 95%
	const phat = s / n;
	const z2 = z * z;
	const denominator = 1 + z2 / n;
	const center = phat + z2 / (2 * n);
	const spread = z * Math.sqrt((phat * (1 - phat)) / n + z2 / (4 * n * n));
	const wilsonLower = Math.max(0, (center - spread) / denominator);
	const wilsonUpper = Math.min(1, (center + spread) / denominator);
	return {
		k: kk,
		estimate: phat ** kk,
		wilsonLower,
		wilsonUpper,
		lowerBoundPowerK: wilsonLower ** kk,
	};
}

export interface EvalCellStability {
	modelId: string;
	role: string;
	difficulty: EvalDifficultyTier;
	runs: number;
	passRate: number;
	/** F12.43: the cell's pass^k reliability (k=3 default) — present whenever the cell has ≥1 run. */
	passPowerK?: PassPowerK;
	/** max − min graded quality across the cell's runs, in [0, 1]; 0 for a single run (no spread). */
	qualitySpread: number;
	verdict: EvalStabilityVerdict;
	/** 0..1 trust in the verdict: 0 for `thin`, scaling with decisiveness + sample count for a `settled` cell. */
	confidence: number;
	/** How many MORE runs to reach `targetSettledRuns` (0 for an already-settled cell); the re-eval budget ask. */
	runsOwed: number;
	/** Operator-facing one-liner explaining the verdict. */
	reason: string;
}

/** Per-(model, role) rollup of cell stability — the headline the selector/operator reads before trusting the fitness. */
export interface ModelRoleStability {
	modelId: string;
	role: string;
	cells: number;
	/** Cells whose verdict is `settled_pass` or `settled_fail`. */
	settledCells: number;
	/** Cells whose verdict is `flaky`. */
	flakyCells: number;
	/** Cells whose verdict is `thin`. */
	thinCells: number;
	/** settledCells ÷ cells in [0, 1] — the fraction of this (model, role)'s measured cells whose verdict is trustworthy. */
	settledFraction: number;
	/** Sum of `runsOwed` across the (model, role)'s cells — the total re-eval budget to settle everything unsettled. */
	totalRunsOwed: number;
	/** Mean cell `confidence` across the (model, role) in [0, 1]. */
	meanConfidence: number;
	/** F12.43: the WORST cell's conservative all-k-pass floor (wilsonLower^k) — the weakest-link reliability. */
	minLowerBoundPassPowerK: number | null;
}

function clamp01(value: number): number {
	if (Number.isNaN(value)) {
		return 0;
	}
	return Math.min(1, Math.max(0, value));
}

const KEY_SEP = " ";

/**
 * Compute the graded-quality SPREAD (max − min, clamped to [0,1]) across a cell's runs — the run-to-run intermittency
 * signal the pass-rate hides. A `NaN` quality is treated as 0 (matching the aggregator's `clamp01`); a single run has
 * spread 0. Only the cell's OWN (model, role, tier) runs contribute.
 */
function qualitySpreadForCell(runs: readonly ModelEvalRun[], cell: ModelEvalCellSummary): number {
	let min = Number.POSITIVE_INFINITY;
	let max = Number.NEGATIVE_INFINITY;
	let count = 0;
	for (const run of runs) {
		if (run.modelId !== cell.modelId || run.role !== cell.role || run.difficulty !== cell.difficulty) {
			continue;
		}
		const quality = clamp01(run.qualityScore);
		min = Math.min(min, quality);
		max = Math.max(max, quality);
		count += 1;
	}
	if (count === 0) {
		return 0;
	}
	return clamp01(max - min);
}

/**
 * Judge ONE aggregated cell's stability against the policy (pure). Precedence:
 *   1. `runs < minSettledRuns` ⇒ `thin` (owe runs up to the target; confidence 0);
 *   2. else `flaky` if the pass-rate is inside the margin band around the bar OR the quality spread exceeds the max
 *      (owe runs up to the target; confidence scaled DOWN by how borderline / how spread it is);
 *   3. else `settled_pass` (pass-rate ≥ bar + margin) or `settled_fail` (pass-rate ≤ bar − margin), 0 runs owed.
 * The reliability bar comes from the aggregation policy (the same bar `cleared` uses), so the two agree on the threshold.
 */
export function judgeCellStability(
	cell: ModelEvalCellSummary,
	qualitySpread: number,
	policy: EvalStabilityPolicy = DEFAULT_EVAL_STABILITY_POLICY,
	aggregatePolicy: AggregateModelEvalPolicy = DEFAULT_AGGREGATE_MODEL_EVAL_POLICY,
): EvalCellStability {
	const minSettled = Math.max(1, Math.floor(policy.minSettledRuns));
	const targetSettled = Math.max(minSettled, Math.floor(policy.targetSettledRuns));
	const margin = clamp01(policy.passRateMargin);
	const maxSpread = clamp01(policy.maxSettledQualitySpread);
	const bar = clamp01(aggregatePolicy.reliabilityBar);
	const spread = clamp01(qualitySpread);

	const base = {
		modelId: cell.modelId,
		role: cell.role,
		difficulty: cell.difficulty,
		runs: cell.runs,
		passRate: cell.passRate,
		qualitySpread: spread,
		// F12.43: successes reconstructed from the folded rate (the summary does not carry the raw count).
		...(cell.runs > 0 ? { passPowerK: computePassPowerK(Math.round(cell.passRate * cell.runs), cell.runs) } : {}),
	};
	const owedTo = (target: number): number => Math.max(0, target - cell.runs);

	// (1) Too few runs to pronounce anything.
	if (cell.runs < minSettled) {
		return {
			...base,
			verdict: "thin",
			confidence: 0,
			runsOwed: owedTo(targetSettled),
			reason: `Only ${cell.runs} run(s) (< ${minSettled}) — too thin to settle a verdict; owe ${owedTo(targetSettled)} more.`,
		};
	}

	// The upper/lower decisive thresholds around the reliability bar. Clamp so a high bar + wide margin can't push the
	// upper threshold past 1 (making `settled_pass` impossible); likewise the lower past 0.
	const upper = Math.min(1, bar + margin);
	const lower = Math.max(0, bar - margin);
	const borderlinePassRate = cell.passRate < upper && cell.passRate > lower;
	const spreadTooWide = spread > maxSpread;

	// (2) Well-sampled but unsettled.
	if (borderlinePassRate || spreadTooWide) {
		// Confidence erodes with how central the pass-rate is (distance from the nearer decisive edge) and how wide the
		// spread is; a doubly-flaky cell (borderline AND spread) scores lower than a singly-flaky one.
		const passRateDoubt = borderlinePassRate
			? Math.min(cell.passRate - lower, upper - cell.passRate) / Math.max(margin, Number.EPSILON)
			: 0;
		const spreadDoubt = spreadTooWide ? clamp01((spread - maxSpread) / Math.max(1 - maxSpread, Number.EPSILON)) : 0;
		const confidence = clamp01(1 - Math.max(passRateDoubt, spreadDoubt)) * 0.5; // a flaky cell caps at 0.5 trust
		const why = borderlinePassRate
			? `pass-rate ${cell.passRate.toFixed(2)} is within ±${margin} of the ${bar} bar`
			: `quality swings by ${spread.toFixed(2)} (> ${maxSpread}) run-to-run`;
		return {
			...base,
			verdict: "flaky",
			confidence,
			runsOwed: owedTo(targetSettled),
			reason: `Flaky: ${why} across ${cell.runs} runs — owe ${owedTo(targetSettled)} more to settle it.`,
		};
	}

	// (3) Settled — decisively above or below the bar, low spread, well-sampled.
	const passed = cell.passRate >= upper;
	// Confidence grows with distance past the decisive edge and with sample count (more repeats ⇒ firmer), 0.5..1.
	let decisiveness: number;
	if (passed) {
		decisiveness = clamp01((cell.passRate - upper) / Math.max(1 - upper, Number.EPSILON));
	} else if (lower <= 0) {
		// Degenerate fail floor: when the bar ≤ margin clamps `lower` to 0, the only reachable settled_fail is passRate 0
		// (all runs failed) — the maximally decisive fail, so it is fully decisive (not the degenerate 0/EPSILON = 0).
		decisiveness = cell.passRate <= 0 ? 1 : 0;
	} else {
		decisiveness = clamp01((lower - cell.passRate) / lower);
	}
	const sampleFirmness = clamp01((cell.runs - minSettled) / Math.max(targetSettled - minSettled, 1));
	const confidence = clamp01(0.5 + 0.5 * ((decisiveness + sampleFirmness) / 2));
	return {
		...base,
		verdict: passed ? "settled_pass" : "settled_fail",
		confidence,
		runsOwed: 0,
		reason: passed
			? `Settled PASS: ${cell.passRate.toFixed(2)} ≥ ${upper.toFixed(2)} over ${cell.runs} runs, low spread (${spread.toFixed(2)}).`
			: `Settled FAIL: ${cell.passRate.toFixed(2)} ≤ ${lower.toFixed(2)} over ${cell.runs} runs, low spread (${spread.toFixed(2)}).`,
	};
}

/**
 * Score every (model, role, difficulty) cell's stability from the raw graded runs (pure). Folds the runs to cell
 * summaries via {@link summarizeModelEvalCells} (the SAME aggregation the fitness fold uses, so the pass-rate/bar agree),
 * pairs each cell with its graded-quality spread, and judges it. Deterministic order (worst-first, so an operator/rail
 * sees the cells most in doubt at the top): `thin` → `flaky` → `settled_*`, then more-owed first, then modelId, role,
 * tier rank.
 */
export function scoreModelEvalStability(
	runs: readonly ModelEvalRun[],
	policy: EvalStabilityPolicy = DEFAULT_EVAL_STABILITY_POLICY,
	aggregatePolicy: AggregateModelEvalPolicy = DEFAULT_AGGREGATE_MODEL_EVAL_POLICY,
): EvalCellStability[] {
	const cells = summarizeModelEvalCells(runs, aggregatePolicy);
	const scored = cells.map((cell) =>
		judgeCellStability(cell, qualitySpreadForCell(runs, cell), policy, aggregatePolicy),
	);
	return scored.sort(
		(left, right) =>
			VERDICT_ORDER[left.verdict] - VERDICT_ORDER[right.verdict] ||
			right.runsOwed - left.runsOwed ||
			left.modelId.localeCompare(right.modelId) ||
			left.role.localeCompare(right.role) ||
			TIER_RANK[left.difficulty] - TIER_RANK[right.difficulty],
	);
}

/** Worst-first ordering of verdicts for a "what needs settling" listing (`thin`/`flaky` before the trustworthy ones). */
const VERDICT_ORDER: Record<EvalStabilityVerdict, number> = {
	thin: 0,
	flaky: 1,
	settled_pass: 2,
	settled_fail: 2,
};

/**
 * Roll the per-cell stability up per (model, role) (pure) — the headline the selector reads before RESTING on a fitness
 * record: how much of this (model, role)'s eval evidence is actually SETTLED, how many runs are owed to settle the rest,
 * and the mean confidence. A (model, role) with no cells contributes nothing. Deterministic order: least-settled first
 * (so the shakiest models surface), then most-owed, then modelId, role.
 */
export function summarizeModelRoleStability(
	runs: readonly ModelEvalRun[],
	policy: EvalStabilityPolicy = DEFAULT_EVAL_STABILITY_POLICY,
	aggregatePolicy: AggregateModelEvalPolicy = DEFAULT_AGGREGATE_MODEL_EVAL_POLICY,
): ModelRoleStability[] {
	const perCell = scoreModelEvalStability(runs, policy, aggregatePolicy);

	interface Acc {
		modelId: string;
		role: string;
		cells: number;
		settledCells: number;
		flakyCells: number;
		thinCells: number;
		totalRunsOwed: number;
		confidenceSum: number;
		minLowerBoundPassPowerK: number | null;
	}
	const byModelRole = new Map<string, Acc>();
	for (const cell of perCell) {
		const key = `${cell.modelId}${KEY_SEP}${cell.role}`;
		const acc = byModelRole.get(key) ?? {
			modelId: cell.modelId,
			role: cell.role,
			cells: 0,
			settledCells: 0,
			flakyCells: 0,
			thinCells: 0,
			totalRunsOwed: 0,
			confidenceSum: 0,
			minLowerBoundPassPowerK: null,
		};
		acc.cells += 1;
		if (cell.verdict === "settled_pass" || cell.verdict === "settled_fail") {
			acc.settledCells += 1;
		} else if (cell.verdict === "flaky") {
			acc.flakyCells += 1;
		} else {
			acc.thinCells += 1;
		}
		acc.totalRunsOwed += cell.runsOwed;
		acc.confidenceSum += cell.confidence;
		if (cell.passPowerK) {
			acc.minLowerBoundPassPowerK =
				acc.minLowerBoundPassPowerK === null
					? cell.passPowerK.lowerBoundPowerK
					: Math.min(acc.minLowerBoundPassPowerK, cell.passPowerK.lowerBoundPowerK);
		}
		byModelRole.set(key, acc);
	}

	return [...byModelRole.values()]
		.map(
			(acc): ModelRoleStability => ({
				modelId: acc.modelId,
				role: acc.role,
				cells: acc.cells,
				settledCells: acc.settledCells,
				flakyCells: acc.flakyCells,
				thinCells: acc.thinCells,
				settledFraction: acc.cells > 0 ? acc.settledCells / acc.cells : 0,
				totalRunsOwed: acc.totalRunsOwed,
				meanConfidence: acc.cells > 0 ? acc.confidenceSum / acc.cells : 0,
				minLowerBoundPassPowerK: acc.minLowerBoundPassPowerK,
			}),
		)
		.sort(
			(left, right) =>
				left.settledFraction - right.settledFraction ||
				right.totalRunsOwed - left.totalRunsOwed ||
				left.modelId.localeCompare(right.modelId) ||
				left.role.localeCompare(right.role),
		);
}

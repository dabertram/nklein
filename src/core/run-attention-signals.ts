/**
 * §5.AG run-attention signal deriver — the TIME/BUDGET-aware upstream that turns raw run telemetry (activity &
 * heartbeat TIMESTAMPS, iteration/wall-time/token counters, retry-budget) + an injected CLOCK into the derived
 * operator signals the board classifier consumes. `classifyOperatorTaskState` already knows how to react to
 * `heartbeatLost` / `noProgressOrLoop` and a `risky` gate — but it takes those as pre-tripped booleans and has NO
 * clock, so today the signal map (`mapSessionSummaryToOperatorSignals`) defaults them to `false`. This module is the
 * missing piece: given last-activity age, heartbeat age, and how close the run is to a ceiling, it decides:
 *   • LIVENESS  — is the run active, idle, stalled (no progress over a window), or silent (heartbeat lost)?
 *   • ATTENTION — is the run APPROACHING a budget/iteration/timeout ceiling (the operator-`risky` precursor)?
 * and folds both into an `OperatorSignalOverrides`-shaped result that plugs straight back into the signal map.
 *
 * Pure + deterministic (mirrors `agent-stuckness` / `background-eval-admission`): all timestamps + the `nowMs` clock +
 * the thresholds are INJECTED, so the whole liveness/risk policy is one tested rule set, not scattered ad-hoc
 * `Date.now() - x > y` checks at the runtime call sites.
 */

/**
 * The time-derived liveness of a run, worst-first for precedence:
 *   • `silent`  — the heartbeat is gone (aged past the lost window) — the run may be dead (§5.A). Maps to the
 *                 classifier's `heartbeatLost`.
 *   • `stalled` — heartbeat still present, but NO forward activity for a full stall window — parked / no-progress
 *                 (§5.AA). Maps to the classifier's `noProgressOrLoop`.
 *   • `idle`    — no recent activity but well within the stall window (a normal quiet gap, e.g. a long model turn).
 *   • `active`  — activity within the idle window: healthily progressing.
 */
export type RunLiveness = "active" | "idle" | "stalled" | "silent";

/** Injected run telemetry for the liveness read. All ages are computed against the caller-supplied `nowMs` clock. */
export interface RunLivenessSignals {
	/** Wall-clock now (injected clock — never read the ambient clock here). Milliseconds since epoch. */
	nowMs: number;
	/**
	 * Timestamp (ms) of the last observed FORWARD activity — a tool call / output / diff / passing check. `null` when
	 * the run has produced nothing yet (never started emitting): treated as "no activity age is known".
	 */
	lastActivityAtMs: number | null;
	/** Timestamp (ms) of the last heartbeat. `null` when heartbeats were never observed (e.g. no heartbeat channel). */
	lastHeartbeatAtMs: number | null;
	/**
	 * Whether a live run is expected to be beating right now. When false (queued / finished / never started), a missing
	 * heartbeat is NOT `silent` — only a run that SHOULD be alive can be silent.
	 */
	expectsHeartbeat: boolean;
}

export interface RunLivenessThresholds {
	/** Activity newer than this (ms) → `active`. At/after → at least `idle`. */
	idleAfterMs: number;
	/** No activity for at least this long (ms) while still beating → `stalled` (no-progress over a window). */
	stalledAfterMs: number;
	/** Heartbeat older than this (ms) → `silent` (heartbeat lost), overriding activity age. */
	heartbeatLostAfterMs: number;
}

/**
 * Conservative defaults (align with the §5.T long-wall-time posture — small local models are slow but alive): a full
 * minute of quiet is still `idle`, five minutes of no progress is `stalled`, and a heartbeat gone for two minutes is
 * `silent`. Callers override per run profile.
 */
export const DEFAULT_RUN_LIVENESS_THRESHOLDS: RunLivenessThresholds = {
	idleAfterMs: 60_000,
	stalledAfterMs: 300_000,
	heartbeatLostAfterMs: 120_000,
};

/** Age (ms) of a timestamp against the clock, or `null` when the timestamp is unknown or lies in the future. */
function ageMs(nowMs: number, atMs: number | null): number | null {
	if (atMs === null) {
		return null;
	}
	const age = nowMs - atMs;
	// A future timestamp (clock skew) is treated as "just happened" — age 0, never a negative age.
	return age < 0 ? 0 : age;
}

/**
 * Classify a run's liveness from its activity/heartbeat ages. Precedence is worst-first: a lost heartbeat (`silent`)
 * outranks a stall, which outranks `idle`/`active`. A run that isn't expected to beat can never be `silent`. When the
 * heartbeat is present but no forward activity has been seen for the stall window → `stalled`; a shorter quiet gap →
 * `idle`; recent activity → `active`. An unknown activity age (nothing emitted yet) on a beating run reads `idle`
 * (waiting to start), not `stalled` — a stall requires a KNOWN age past the window.
 */
export function assessRunLiveness(
	signals: RunLivenessSignals,
	thresholds: RunLivenessThresholds = DEFAULT_RUN_LIVENESS_THRESHOLDS,
): RunLiveness {
	const heartbeatAge = ageMs(signals.nowMs, signals.lastHeartbeatAtMs);
	// SILENT — a run that should be beating has no heartbeat, or its heartbeat aged past the lost window.
	if (signals.expectsHeartbeat) {
		if (heartbeatAge === null || heartbeatAge >= thresholds.heartbeatLostAfterMs) {
			return "silent";
		}
	}

	const activityAge = ageMs(signals.nowMs, signals.lastActivityAtMs);
	// STALLED — heartbeat present, but a KNOWN activity age past the stall window (no forward progress over a window).
	if (activityAge !== null && activityAge >= thresholds.stalledAfterMs) {
		return "stalled";
	}
	// IDLE — activity age unknown (not started emitting) or a shorter quiet gap.
	if (activityAge === null || activityAge >= thresholds.idleAfterMs) {
		return "idle";
	}
	return "active";
}

/** Which ceiling a run is pressing against — the operator sees WHICH budget is nearly spent. */
export type RunBudgetKind = "iterations" | "wall_time" | "tokens";

/** A single ceiling: how much is used out of a cap. `cap` ≤ 0 means "no cap" (never contributes pressure). */
export interface RunBudgetCeiling {
	kind: RunBudgetKind;
	used: number;
	cap: number;
}

export interface RunBudgetPressure {
	/** True when the run is at/over the warn fraction of its tightest ceiling — the operator-`risky` precursor. */
	approachingCeiling: boolean;
	/** The tightest ceiling (highest used fraction), or `null` when no capped ceiling was supplied. */
	tightest: RunBudgetKind | null;
	/** The tightest ceiling's used fraction in [0, 1], clamped (over-cap reads 1). `0` when there is no capped ceiling. */
	fraction: number;
}

/**
 * The used fraction of a ceiling in [0, 1] — clamped so an over-cap value reads a full 1 and a non-positive cap (no
 * cap) reads 0. Negative `used` is floored at 0.
 */
function usedFraction(ceiling: RunBudgetCeiling): number {
	if (ceiling.cap <= 0) {
		return 0;
	}
	const raw = ceiling.used / ceiling.cap;
	if (raw <= 0) {
		return 0;
	}
	return raw >= 1 ? 1 : raw;
}

/**
 * The fraction of a ceiling at/above which a run is "approaching" it and the operator should be warned. 0.8 = flag at
 * 80% of the iteration / wall-time / token budget (early enough to intervene before the run is force-stopped).
 */
export const DEFAULT_RUN_BUDGET_WARN_FRACTION = 0.8;

/**
 * Assess how close a run is to its tightest budget ceiling. Considers every capped ceiling and reports the one with
 * the highest used fraction; `approachingCeiling` trips when that fraction is at/above `warnFraction`. Ceilings with
 * no cap (`cap` ≤ 0) are ignored. With no capped ceiling supplied, the result is calm (`approachingCeiling: false`,
 * `tightest: null`, `fraction: 0`).
 */
export function assessRunBudgetPressure(
	ceilings: readonly RunBudgetCeiling[],
	warnFraction: number = DEFAULT_RUN_BUDGET_WARN_FRACTION,
): RunBudgetPressure {
	let tightest: RunBudgetKind | null = null;
	let fraction = 0;
	for (const ceiling of ceilings) {
		if (ceiling.cap <= 0) {
			continue;
		}
		const f = usedFraction(ceiling);
		if (tightest === null || f > fraction) {
			tightest = ceiling.kind;
			fraction = f;
		}
	}
	return { approachingCeiling: tightest !== null && fraction >= warnFraction, tightest, fraction };
}

/**
 * The classifier-facing signals this deriver computes. `heartbeatLost` + `noProgressOrLoop` are a structural subset of
 * `OperatorSignalOverrides`, so those two spread straight into `mapSessionSummaryToOperatorSignals` without this module
 * importing the classifier. `approachingCeiling` is the deriver's own "nearing a budget ceiling" read — an
 * operator-attention precursor a surface can act on (e.g. flag the run) alongside the mapped overrides.
 */
export interface RunAttentionOverrides {
	/** Derived from `silent` liveness — feeds the classifier's `heartbeatLost`. */
	heartbeatLost: boolean;
	/** Derived from `stalled` liveness — feeds the classifier's `noProgressOrLoop`. */
	noProgressOrLoop: boolean;
	/** Derived from budget pressure — the run is approaching a ceiling and warrants operator attention. */
	approachingCeiling: boolean;
}

export interface RunAttentionThresholds {
	liveness?: RunLivenessThresholds;
	budgetWarnFraction?: number;
}

export interface RunAttentionAssessment {
	liveness: RunLiveness;
	budget: RunBudgetPressure;
	/** The classifier-facing signals derived from liveness + budget, ready to spread into the signal map's overrides. */
	overrides: RunAttentionOverrides;
}

/**
 * §5.AG one-call deriver: from a run's liveness signals + its budget ceilings, produce the full attention read —
 * the liveness verdict, the budget-pressure verdict, and the derived classifier overrides. The runtime passes
 * `assessment.overrides` into `mapSessionSummaryToOperatorSignals` so a stalled run reads `stuck`, a silent run reads
 * `stuck` (lost heartbeat), and a run approaching a ceiling can be surfaced as attention-worthy — all from timestamps
 * + a clock, closing the gap the signal map's `false` defaults leave open.
 */
export function assessRunAttention(
	liveness: RunLivenessSignals,
	ceilings: readonly RunBudgetCeiling[],
	thresholds: RunAttentionThresholds = {},
): RunAttentionAssessment {
	const livenessState = assessRunLiveness(liveness, thresholds.liveness);
	const budget = assessRunBudgetPressure(ceilings, thresholds.budgetWarnFraction);
	return {
		liveness: livenessState,
		budget,
		overrides: {
			heartbeatLost: livenessState === "silent",
			noProgressOrLoop: livenessState === "stalled",
			approachingCeiling: budget.approachingCeiling,
		},
	};
}

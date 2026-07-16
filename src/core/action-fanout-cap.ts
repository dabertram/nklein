/**
 * Action fan-out cap (Phase 7S / S9) — PURE decision core.
 *
 * WHAT: the existing guards already bound loops/runaway generation (the turn-loop guard §12, learned retry budgets
 * F3.30, concurrency caps F3.21). S9's ADDITION is the anti-FAN-OUT cap: a single poisoned issue must not be able to
 * drive the agent to act on a HUNDRED targets ("post an acknowledgement comment on every open issue"). This core bounds,
 * per session, (a) the total number of capped actions, (b) the actions against any one target, and (c) the number of
 * DISTINCT targets touched (the fan-out breadth) — so an injection that induces spam hits a ceiling.
 *
 * WHY pure: like the other §5.L cores, keeping the decision a total, deterministic predicate (no I/O, no clock) makes it
 * unit-testable and lets one rule serve every action seam. It carries NO default limits of its own — an omitted limit is
 * unlimited — so a caller opts into exactly the ceilings it wants and the default (empty limits) is a byte-identical
 * no-op. That is deliberate: a hair-trigger cap that strands legitimate multi-target work is worse than none, so the
 * operator/config chooses the numbers; this module only enforces them.
 */

export interface ActionFanoutLimits {
	/** Max total capped actions in the session. Omitted ⇒ unlimited. */
	readonly maxTotal?: number;
	/** Max actions against any SINGLE target (anti-hammering). Omitted ⇒ unlimited. */
	readonly maxPerTarget?: number;
	/** Max number of DISTINCT targets acted upon (anti-fan-out breadth). Omitted ⇒ unlimited. */
	readonly maxDistinctTargets?: number;
}

/** Accumulated action counts. `perTarget` maps a target identity → how many actions have hit it. Treat as immutable. */
export interface ActionFanoutState {
	readonly total: number;
	readonly perTarget: Readonly<Record<string, number>>;
}

export interface ActionFanoutVerdict {
	/** True ⇒ one more action against the target is within all configured limits. */
	readonly allow: boolean;
	/** When `allow` is false, one operator-facing sentence naming which ceiling would be exceeded; null when allowed. */
	readonly reason: string | null;
}

/** The empty starting state — no actions recorded. */
export function emptyActionFanoutState(): ActionFanoutState {
	return { total: 0, perTarget: {} };
}

function normalizeTarget(target: string): string {
	return target.trim() || "unknown target";
}

/**
 * Decide whether ONE more action against `target` is within the configured limits, given the prior state. Pure — never
 * mutates. An omitted limit does not constrain. A target already seen does not count against `maxDistinctTargets` (only a
 * genuinely NEW target grows the breadth). Fail-CLOSED: the first ceiling that would be exceeded denies.
 */
export function checkActionFanout(
	state: ActionFanoutState,
	target: string,
	limits: ActionFanoutLimits,
): ActionFanoutVerdict {
	const key = normalizeTarget(target);
	const priorForTarget = state.perTarget[key] ?? 0;
	const isNewTarget = priorForTarget === 0;

	if (limits.maxTotal !== undefined && state.total + 1 > limits.maxTotal) {
		return {
			allow: false,
			reason: `action refused: the session's total action cap (${limits.maxTotal}) would be exceeded — possible injection-driven fan-out.`,
		};
	}
	if (limits.maxPerTarget !== undefined && priorForTarget + 1 > limits.maxPerTarget) {
		return {
			allow: false,
			reason: `action refused: the per-target action cap (${limits.maxPerTarget}) for "${key}" would be exceeded — possible injection-driven hammering.`,
		};
	}
	if (limits.maxDistinctTargets !== undefined && isNewTarget) {
		const distinct = Object.keys(state.perTarget).length;
		if (distinct + 1 > limits.maxDistinctTargets) {
			return {
				allow: false,
				reason: `action refused: the distinct-target cap (${limits.maxDistinctTargets}) would be exceeded — possible injection-driven fan-out across many targets.`,
			};
		}
	}
	return { allow: true, reason: null };
}

/** Record one action against `target`, returning the NEW state (input is never mutated). */
export function recordAction(state: ActionFanoutState, target: string): ActionFanoutState {
	const key = normalizeTarget(target);
	return {
		total: state.total + 1,
		perTarget: { ...state.perTarget, [key]: (state.perTarget[key] ?? 0) + 1 },
	};
}

/** Whether any limit is actually set — a fast "is the cap even active?" check so callers can skip the machinery. */
export function hasAnyFanoutLimit(limits: ActionFanoutLimits): boolean {
	return limits.maxTotal !== undefined || limits.maxPerTarget !== undefined || limits.maxDistinctTargets !== undefined;
}

/**
 * A GENEROUS default session-total outward-action backstop (S9). Deliberately high: it only trips on egregious
 * injection-driven runaway (post-spam / API-limit exhaustion), never on realistic research/coding work — a marathon
 * session stays well under it. It is the ONLY cap safe to default-ON, because a session TOTAL has no read-vs-write
 * granularity problem (per-target / per-tool caps still need real tool metadata and stay opt-in). Tune with real data.
 */
export const DEFAULT_OUTWARD_FANOUT_CAP = 250;

/**
 * Resolve the session-total outward-action cap from an env override. Unset/blank → {@link DEFAULT_OUTWARD_FANOUT_CAP};
 * a positive integer → that value; `0` or an invalid value → `null` (disabled — unlimited). Pure/total.
 */
export function resolveOutwardFanoutCap(rawEnv: string | undefined): number | null {
	if (rawEnv === undefined || rawEnv.trim() === "") {
		return DEFAULT_OUTWARD_FANOUT_CAP;
	}
	const parsed = Number.parseInt(rawEnv.trim(), 10);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

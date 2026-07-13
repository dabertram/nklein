import { type AgentLedgerEvent, type AgentTransitionEvent, buildTransitionEvent } from "./agent-attempt-ledger.js";
import type { OpportunisticWorkKind } from "./opportunistic-work-ranker.js";

/**
 * F1.36 (§5.AW) — the two pieces the live idle-work sweep was missing: a BACKGROUND-BUDGET gate (idle work must
 * never consume unbounded capacity even when the swarm looks idle all day) and REALIZED-VALUE recording (every
 * dispatched opportunistic action retains its outcome in the §5.AF ledger, and a projection folds those into a
 * per-kind realized-rate so the ranker's priorities can eventually be evidence-driven instead of fixed). Pure +
 * clock-injected; the runtime wires it around its existing flag-gated sweep.
 */

export interface OpportunisticBudgetInput {
	now: number;
	/** Epoch ms of prior opportunistic dispatches (any horizon; only the trailing hour matters). */
	recentDispatchAts: readonly number[];
	/** Currently-running opportunistic actions. */
	activeCount: number;
	/** Max dispatches in any trailing hour. Default 6. */
	maxPerHour?: number;
	/** Max concurrently-running opportunistic actions. Default 1. */
	maxConcurrent?: number;
}

export type OpportunisticBudgetDecision =
	| { allow: true }
	| { allow: false; reason: "concurrent_cap" | "hourly_budget" };

const HOUR_MS = 3_600_000;

/** The background-budget gate: concurrency first (cheap + absolute), then the trailing-hour dispatch budget. */
export function decideOpportunisticBudget(input: OpportunisticBudgetInput): OpportunisticBudgetDecision {
	const maxConcurrent = Math.max(1, Math.trunc(input.maxConcurrent ?? 1));
	if (input.activeCount >= maxConcurrent) {
		return { allow: false, reason: "concurrent_cap" };
	}
	const maxPerHour = Math.max(1, Math.trunc(input.maxPerHour ?? 6));
	const windowStart = input.now - HOUR_MS;
	const inWindow = input.recentDispatchAts.filter((at) => at > windowStart).length;
	if (inWindow >= maxPerHour) {
		return { allow: false, reason: "hourly_budget" };
	}
	return { allow: true };
}

export const OPPORTUNISTIC_WORK_DECISION = "opportunistic_work";
export const OPPORTUNISTIC_WORK_WORKFLOW_ID = "opportunistic-idle-work";

export type OpportunisticWorkOutcome = "realized" | "no_value" | "error";

/**
 * Retain one dispatched action's outcome as ledger evidence (the F1.26/F1.33 retention pattern): keyed by
 * `<kind>:<targetRef>` so projections can both count per kind and trace individual targets.
 */
export function buildOpportunisticWorkOutcomeEvent(input: {
	workspacePathHash: string;
	kind: OpportunisticWorkKind;
	/** What the action ran against (card id, eval cell key, note ref). */
	targetRef: string;
	outcome: OpportunisticWorkOutcome;
	detail?: string | null;
	recordedAt?: number;
}): AgentTransitionEvent {
	return buildTransitionEvent({
		workflowId: OPPORTUNISTIC_WORK_WORKFLOW_ID,
		taskId: `${input.kind}:${input.targetRef}`,
		workspacePathHash: input.workspacePathHash,
		from: "idle_dispatch",
		to: `opportunistic_${input.outcome}`,
		reason: input.detail?.slice(0, 900) ?? null,
		controllerDecision: OPPORTUNISTIC_WORK_DECISION,
		...(input.recordedAt !== undefined ? { recordedAt: input.recordedAt } : {}),
	});
}

export interface OpportunisticValueSummary {
	kind: string;
	dispatched: number;
	realized: number;
	noValue: number;
	errored: number;
	/** realized / dispatched (0 when nothing dispatched). */
	realizedRate: number;
}

/** Fold retained outcome events into a per-kind realized-value scorecard (sorted by kind for stable output). */
export function summarizeOpportunisticValue(events: readonly AgentLedgerEvent[]): OpportunisticValueSummary[] {
	const byKind = new Map<string, { dispatched: number; realized: number; noValue: number; errored: number }>();
	for (const event of events) {
		if (event.kind !== "transition" || event.controllerDecision !== OPPORTUNISTIC_WORK_DECISION) {
			continue;
		}
		const kind = event.taskId.split(":", 1)[0] ?? "";
		if (!kind) {
			continue;
		}
		const bucket = byKind.get(kind) ?? { dispatched: 0, realized: 0, noValue: 0, errored: 0 };
		bucket.dispatched += 1;
		if (event.to === "opportunistic_realized") {
			bucket.realized += 1;
		} else if (event.to === "opportunistic_no_value") {
			bucket.noValue += 1;
		} else if (event.to === "opportunistic_error") {
			bucket.errored += 1;
		}
		byKind.set(kind, bucket);
	}
	return [...byKind.entries()]
		.map(([kind, bucket]) => ({
			kind,
			...bucket,
			realizedRate: bucket.dispatched > 0 ? bucket.realized / bucket.dispatched : 0,
		}))
		.sort((left, right) => left.kind.localeCompare(right.kind));
}

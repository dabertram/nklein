/**
 * §5.AB confidence/resource-aware routing — the per-routing-decision LOG + its calibration summary. Every time the
 * router picks a model for a task, we can record what it PREDICTED (the route + the model + the difficulty) alongside
 * what actually HAPPENED (the run outcome, the verifier verdict) and the state at decision time (uncertainty, resource
 * pressure). Replaying those records tells us whether the router is well-CALIBRATED — does the model it picked actually
 * succeed, does high uncertainty predict failure, how often does it have to escalate?
 *
 * This module owns the record SHAPE + a normalizing builder + a pure calibration summary over a batch of records — so
 * it is a complete, testable unit BEFORE the (effectful) routing seam emits into it: the summary is the value, and it
 * is pure over injected records. Composes {@link ModelOutcomeKind} by import only. Pure + total + deterministic.
 */

import type { ModelOutcomeKind } from "./model-behavior-profile.js";

/** The route the router took (mirrors `NKleinTaskRoutingDecision["type"]`, kept as a string to stay decoupled). */
export type RoutingRouteType = "assign" | "route_up" | "decompose" | "escalate";

/** Whether a downstream verifier/acceptance gate passed, failed, or never ran for this decision. */
export type VerifierOutcome = "pass" | "fail" | "not_run";

export interface RoutingDecisionRecord {
	taskId: string;
	/** The route the router chose. */
	routeType: RoutingRouteType;
	/** The model the router selected (null for decompose/escalate, which pick no model). */
	predictedModelKey: string | null;
	/** The §5.AB difficulty the decision was made against (0-100). */
	difficulty: number;
	/** How the run actually went (null when the decision didn't lead to a run, e.g. decompose/escalate). */
	actualOutcome: ModelOutcomeKind | null;
	/** The downstream verifier verdict, or `not_run`. */
	verifierOutcome: VerifierOutcome;
	/** Decision-time uncertainty in [0,1] (1 − calibrated confidence), or null when no confidence signal was present. */
	uncertainty: number | null;
	/** A compact snapshot of resource pressure at decision time (optional). */
	resourceState: { freeGb?: number; endpointBusy?: boolean } | null;
	recordedAt: number;
}

export interface RoutingDecisionInput {
	taskId: string;
	routeType: RoutingRouteType;
	predictedModelKey?: string | null;
	difficulty: number;
	actualOutcome?: ModelOutcomeKind | null;
	verifierOutcome?: VerifierOutcome;
	uncertainty?: number | null;
	resourceState?: { freeGb?: number; endpointBusy?: boolean } | null;
	recordedAt: number;
}

function clamp01OrNull(value: number | null | undefined): number | null {
	if (typeof value !== "number" || !Number.isFinite(value)) {
		return null;
	}
	return Math.max(0, Math.min(1, value));
}

/** Build a normalized routing-decision record from a decision at the routing seam. Total: fills sensible defaults. */
export function buildRoutingDecisionRecord(input: RoutingDecisionInput): RoutingDecisionRecord {
	return {
		taskId: input.taskId,
		routeType: input.routeType,
		predictedModelKey: input.predictedModelKey ?? null,
		difficulty: Number.isFinite(input.difficulty) ? Math.max(0, Math.min(100, input.difficulty)) : 0,
		actualOutcome: input.actualOutcome ?? null,
		verifierOutcome: input.verifierOutcome ?? "not_run",
		uncertainty: clamp01OrNull(input.uncertainty),
		resourceState: input.resourceState ?? null,
		recordedAt: input.recordedAt,
	};
}

export interface RoutingCalibrationSummary {
	total: number;
	/** Records whose decision led to a real run (actualOutcome present). */
	runCount: number;
	/** Fraction of RUN records whose outcome was `success` (0..1; 0 when no runs). */
	successRate: number;
	/** Fraction of records whose verifier ran that PASSED (0..1; 0 when none ran). */
	verifierPassRate: number;
	/** Fraction of all records that were `escalate` (the router found nothing capable). */
	escalationRate: number;
	/** Mean decision-time uncertainty over records that carried one (null when none did). */
	meanUncertainty: number | null;
	/** Count per route type. */
	routeTypeCounts: Record<RoutingRouteType, number>;
	/**
	 * The calibration signal: over RUN records that carried an uncertainty, the mean uncertainty on FAILED runs minus
	 * the mean on SUCCEEDED runs. A well-calibrated router has this POSITIVE (it was more uncertain about the runs that
	 * failed). null when there aren't both a failed and a succeeded uncertainty-bearing run to compare.
	 */
	uncertaintyFailureGap: number | null;
}

const EMPTY_ROUTE_COUNTS: () => Record<RoutingRouteType, number> = () => ({
	assign: 0,
	route_up: 0,
	decompose: 0,
	escalate: 0,
});

function mean(values: readonly number[]): number | null {
	return values.length === 0 ? null : values.reduce((total, value) => total + value, 0) / values.length;
}

/**
 * Summarize a batch of routing-decision records into calibration metrics — pure over the injected records, so it is
 * useful (and unit-testable) before any producer wires in. The headline `uncertaintyFailureGap` answers "was the router
 * more uncertain about the runs that failed?" — the core calibration question.
 */
export function summarizeRoutingCalibration(records: readonly RoutingDecisionRecord[]): RoutingCalibrationSummary {
	const routeTypeCounts = EMPTY_ROUTE_COUNTS();
	const uncertainties: number[] = [];
	const failedUncertainties: number[] = [];
	const succeededUncertainties: number[] = [];
	let runCount = 0;
	let successCount = 0;
	let verifierRan = 0;
	let verifierPassed = 0;

	for (const record of records) {
		routeTypeCounts[record.routeType] += 1;
		if (record.uncertainty !== null) {
			uncertainties.push(record.uncertainty);
		}
		if (record.verifierOutcome !== "not_run") {
			verifierRan += 1;
			if (record.verifierOutcome === "pass") {
				verifierPassed += 1;
			}
		}
		if (record.actualOutcome !== null) {
			runCount += 1;
			const succeeded = record.actualOutcome === "success";
			if (succeeded) {
				successCount += 1;
			}
			if (record.uncertainty !== null) {
				(succeeded ? succeededUncertainties : failedUncertainties).push(record.uncertainty);
			}
		}
	}

	const meanFailed = mean(failedUncertainties);
	const meanSucceeded = mean(succeededUncertainties);
	return {
		total: records.length,
		runCount,
		successRate: runCount === 0 ? 0 : successCount / runCount,
		verifierPassRate: verifierRan === 0 ? 0 : verifierPassed / verifierRan,
		escalationRate: records.length === 0 ? 0 : routeTypeCounts.escalate / records.length,
		meanUncertainty: mean(uncertainties),
		routeTypeCounts,
		uncertaintyFailureGap: meanFailed !== null && meanSucceeded !== null ? meanFailed - meanSucceeded : null,
	};
}

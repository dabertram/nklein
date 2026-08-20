/**
 * RUN-COMPARISON METRICS — what makes two dev-test runs comparable, and what makes a comparison invalid.
 *
 * This campaign produced a run of numbers that were true and meant nothing:
 *  · `outcome: completed` while the delivered commit was never merged (a card can complete unmerged);
 *  · `acceptance failing` measured against a workspace HEAD the delivery never reached;
 *  · an extraction grade taken from the wrong tree;
 *  · `npm test` green, which the held-out oracle refuses as evidence because the agent wrote it.
 *
 * So the shape here is deliberate: metrics are LAYERED by what they can honestly answer, and every layer
 * carries the condition that would make it a lie. A metric that cannot be invalidated is decoration.
 *
 * The comparison verdict is separate from the metrics for the same reason: two runs can both be measured
 * perfectly and still not be comparable — different wall-clock caps, different models, an aborted run
 * against a settled one. Naming that is the point, because the tempting number ("3/4 vs 1/4") is exactly
 * the one that hides it.
 */

/** How a run ENDED. A run that ran out of clock did not "score" — it was interrupted. */
export type RunTermination = "settled" | "wall_clock" | "stalled" | "error";

export interface RunMetricsInput {
	readonly runId: string;
	readonly projectId: string;
	/** Static project complexity (see dev-test-project-complexity) — the normaliser. */
	readonly complexityScore: number;
	readonly termination: RunTermination;
	readonly wallClockCapMinutes: number;
	readonly durationSeconds: number;
	/** Role → model, so a comparison can refuse when the fleets differ. */
	readonly modelsByRole: Readonly<Record<string, string>>;
	/** L1 — did the pipeline function at all? */
	readonly cardsCreated: number;
	readonly sessions: number;
	readonly toolCalls: number;
	readonly toolErrors: number;
	/** L2 — did work LAND? `cardsMergedVerified` counts only commits proven ancestors of the workspace HEAD. */
	readonly cardsCompleted: number;
	readonly cardsMergedVerified: number;
	/** L3 — is the work RIGHT, judged by something the agent did not author? Null when no oracle exists. */
	readonly oraclePassed: number | null;
	readonly oracleTotal: number | null;
}

export interface RunMetrics extends RunMetricsInput {
	/** Delivery that survived verification, per unit of project complexity. The cross-project comparable. */
	readonly verifiedDeliveryPerComplexity: number | null;
	/** Tool calls spent per card that actually landed — effort efficiency, not effort. */
	readonly toolCallsPerVerifiedCard: number | null;
	readonly toolErrorRate: number | null;
	/** True when the run was cut short: its counts are FLOORS, never scores. */
	readonly interrupted: boolean;
	/** The gap this campaign kept hitting: completed but not actually merged. */
	readonly completedButUnverified: number;
	readonly notes: readonly string[];
}

export function computeRunMetrics(input: RunMetricsInput): RunMetrics {
	const interrupted = input.termination !== "settled";
	const notes: string[] = [];
	if (interrupted) {
		notes.push(
			`Run ended by ${input.termination} at ${Math.round(input.durationSeconds / 60)}m of a ${input.wallClockCapMinutes}m cap — every count below is a FLOOR, not a score.`,
		);
	}
	const completedButUnverified = Math.max(0, input.cardsCompleted - input.cardsMergedVerified);
	if (completedButUnverified > 0) {
		notes.push(
			`${completedButUnverified} card(s) reached Completed without a verified merge — completion is a board state, not evidence that the change landed.`,
		);
	}
	if (input.oracleTotal === null) {
		notes.push("No held-out oracle for this project: correctness is UNMEASURED, not passing.");
	}
	return {
		...input,
		interrupted,
		completedButUnverified,
		verifiedDeliveryPerComplexity:
			input.complexityScore > 0 ? +(input.cardsMergedVerified / input.complexityScore).toFixed(4) : null,
		toolCallsPerVerifiedCard:
			input.cardsMergedVerified > 0 ? +(input.toolCalls / input.cardsMergedVerified).toFixed(1) : null,
		toolErrorRate: input.toolCalls > 0 ? +(input.toolErrors / input.toolCalls).toFixed(3) : null,
		notes,
	};
}

export type ComparabilityVerdict = "comparable" | "comparable_with_caveats" | "not_comparable";

export interface RunComparison {
	readonly verdict: ComparabilityVerdict;
	readonly reasons: readonly string[];
	/** Only populated when the verdict is not `not_comparable`. */
	readonly deltas: Readonly<Record<string, number | null>> | null;
}

/**
 * Compare two runs — and REFUSE when they are not comparable. The refusal is the feature: a difference in
 * models or wall-clock cap explains a delivery gap at least as well as any product change, and a number
 * that silently absorbs that difference is how a campaign convinces itself of a result it did not earn.
 */
export function compareRuns(left: RunMetrics, right: RunMetrics): RunComparison {
	const reasons: string[] = [];
	let blocking = false;

	if (left.projectId !== right.projectId) {
		if (left.complexityScore !== right.complexityScore) {
			blocking = true;
			reasons.push(
				`different projects at different complexity (${left.projectId}=${left.complexityScore} vs ${right.projectId}=${right.complexityScore}) — compare the complexity-normalised rate, not the raw counts`,
			);
		} else {
			reasons.push(`different projects (${left.projectId} vs ${right.projectId}) at equal complexity`);
		}
	}
	const roles = [...new Set([...Object.keys(left.modelsByRole), ...Object.keys(right.modelsByRole)])];
	const differingRoles = roles.filter((role) => left.modelsByRole[role] !== right.modelsByRole[role]);
	if (differingRoles.length > 0) {
		blocking = true;
		reasons.push(
			`different model per role (${differingRoles.map((role) => `${role}: ${left.modelsByRole[role] ?? "—"} vs ${right.modelsByRole[role] ?? "—"}`).join("; ")}) — a fleet change explains a delivery gap as well as any product change`,
		);
	}
	if (left.wallClockCapMinutes !== right.wallClockCapMinutes) {
		reasons.push(
			`different wall-clock caps (${left.wallClockCapMinutes}m vs ${right.wallClockCapMinutes}m) — the shorter run had less room to finish`,
		);
	}
	if (left.interrupted || right.interrupted) {
		reasons.push(
			`at least one run was interrupted (${left.runId}=${left.termination}, ${right.runId}=${right.termination}) — its counts are floors`,
		);
	}

	if (blocking) {
		return { verdict: "not_comparable", reasons, deltas: null };
	}
	return {
		verdict: reasons.length > 0 ? "comparable_with_caveats" : "comparable",
		reasons,
		deltas: {
			cardsMergedVerified: right.cardsMergedVerified - left.cardsMergedVerified,
			cardsCompleted: right.cardsCompleted - left.cardsCompleted,
			toolCalls: right.toolCalls - left.toolCalls,
			oraclePassed:
				left.oraclePassed === null || right.oraclePassed === null ? null : right.oraclePassed - left.oraclePassed,
			verifiedDeliveryPerComplexity:
				left.verifiedDeliveryPerComplexity === null || right.verifiedDeliveryPerComplexity === null
					? null
					: +(right.verifiedDeliveryPerComplexity - left.verifiedDeliveryPerComplexity).toFixed(4),
		},
	};
}

/** F3.24b — pure completion gate for the destructive fleet endpoint-loss probe. */

export interface FleetEndpointLossProofInput {
	/** Null means the ordinary host-spread verifier is running without fault injection. */
	faultModel: string | null;
	injected: boolean;
	modelAbsentAfterInjection: boolean;
	targetTaskId: string | null;
	sameTaskRerouted: boolean;
	allResultsMerged: boolean;
}

export interface FleetEndpointLossProofVerdict {
	required: boolean;
	ok: boolean;
	missing: readonly string[];
}

export interface FleetProofBoardColumn {
	id?: string;
	cards?: readonly { id?: string }[];
}

export interface FleetProofBoardCompletion {
	ok: boolean;
	expectedCount: number;
	observedCount: number;
	mergedCount: number;
	missingTaskIds: readonly string[];
	unmergedTaskIds: readonly string[];
	unexpectedTaskIds: readonly string[];
}

/**
 * Pin completion to the deterministic proof graph. A missing/empty workspace snapshot must never become the
 * mathematical false positive `terminal === total === 0`, and Review is not completion: every expected id must be
 * present specifically in Completed/Done. Unexpected ids also fail closed because they mean the fixture was replaced
 * or contaminated while the destructive probe was running.
 */
export function assessFleetProofBoardCompletion(input: {
	expectedTaskIds: readonly string[];
	columns: readonly FleetProofBoardColumn[];
}): FleetProofBoardCompletion {
	const expected = new Set(input.expectedTaskIds);
	const observed = new Set<string>();
	const merged = new Set<string>();
	for (const column of input.columns) {
		for (const card of column.cards ?? []) {
			if (!card.id) continue;
			observed.add(card.id);
			if (column.id === "completed" || column.id === "done") merged.add(card.id);
		}
	}
	const missingTaskIds = [...expected].filter((id) => !observed.has(id)).sort();
	const unmergedTaskIds = [...expected].filter((id) => !merged.has(id)).sort();
	const unexpectedTaskIds = [...observed].filter((id) => !expected.has(id)).sort();
	return {
		ok:
			expected.size > 0 &&
			missingTaskIds.length === 0 &&
			unmergedTaskIds.length === 0 &&
			unexpectedTaskIds.length === 0,
		expectedCount: expected.size,
		observedCount: observed.size,
		mergedCount: merged.size,
		missingTaskIds,
		unmergedTaskIds,
		unexpectedTaskIds,
	};
}

/**
 * A fault run passes only as one causal chain: the chosen route was actively removed, disappearance was observed,
 * that exact card appeared on another model, and every card ultimately landed in Completed/Done.
 */
export function assessFleetEndpointLossProof(input: FleetEndpointLossProofInput): FleetEndpointLossProofVerdict {
	if (input.faultModel === null) return { required: false, ok: true, missing: [] };
	const missing: string[] = [];
	if (!input.injected) missing.push("active route was not unloaded");
	if (!input.modelAbsentAfterInjection) missing.push("route absence was not observed");
	if (!input.targetTaskId) missing.push("fault target card was not captured");
	if (!input.sameTaskRerouted) missing.push("the faulted card was not observed on another model");
	if (!input.allResultsMerged) missing.push("not every card result reached Completed/Done");
	return { required: true, ok: missing.length === 0, missing };
}

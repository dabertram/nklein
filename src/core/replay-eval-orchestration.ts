import type { AgentLedgerEvent, AgentTransitionEvent } from "./agent-attempt-ledger";
import type { ReplayEventView } from "./ledger-replay-determinism";
import {
	buildReplayEvalRetentionEvent,
	evaluateSelfImprovementReplay,
	type SelfImprovementReplayEvaluation,
} from "./self-improvement-gate";

/**
 * F1.26b — compose the shipped self-improvement REPLAY cores into one outcome: evaluate a captured (pre-patch
 * baseline) ledger against a replayed (patched-tree) ledger with the §5.AF determinism comparator, and build the
 * F1.26-style retention event the M4 gate reads back. Pure over the two ledger captures — the effectful half (running
 * the aimock dev-test suite twice to PRODUCE the captures) is the CLI's job; this is the deterministic seam it drives.
 *
 * `AgentLedgerEvent` is a structural `ReplayEventView` (the comparator reads the same envelope + causal fields), so a
 * captured ledger flows straight in.
 */

export interface ReplayEvalOutcome {
	evaluation: SelfImprovementReplayEvaluation;
	retentionEvent: AgentTransitionEvent;
}

export function buildReplayEvalOutcome(input: {
	captured: readonly AgentLedgerEvent[];
	replayed: readonly AgentLedgerEvent[];
	workflowId: string;
	taskId: string;
	workspacePathHash: string;
	recordedAt?: number;
}): ReplayEvalOutcome {
	const evaluation = evaluateSelfImprovementReplay({
		captured: input.captured as readonly ReplayEventView[],
		replayed: input.replayed as readonly ReplayEventView[],
	});
	const retentionEvent = buildReplayEvalRetentionEvent({
		workflowId: input.workflowId,
		taskId: input.taskId,
		workspacePathHash: input.workspacePathHash,
		evaluation,
		...(input.recordedAt !== undefined ? { recordedAt: input.recordedAt } : {}),
	});
	return { evaluation, retentionEvent };
}

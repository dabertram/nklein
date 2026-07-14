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

/**
 * F1.26b — the AUTO-CAPTURE orchestration: instead of hand-supplied captures, run the aimock dev-test suite ONCE on
 * the baseline tree and ONCE on the patched worktree (the task's result branch), capturing each run's ledger into an
 * ISOLATED dir, then compare. Deterministic (aimock, no live models). The effectful primitives are injected — running
 * the suite, creating/cleaning the worktree, reading a captured ledger — so this sequencing (baseline BEFORE the
 * worktree exists; the worktree ALWAYS cleaned up, even on failure; the two ISOLATED captures compared) is unit-tested
 * without a real git/aimock run; the CLI supplies the live implementations.
 */
export interface ReplayEvalAutoCaptureDeps {
	/** Run the aimock dev-test scenario suite against `treePath`, writing its agent ledger into `ledgerRootDir`. */
	runScenarioSuite: (input: { treePath: string; ledgerRootDir: string }) => Promise<void>;
	/** Materialize the task's result branch in a fresh git worktree; the returned `cleanup` removes it. */
	createResultWorktree: (resultBranch: string) => Promise<{ path: string; cleanup: () => Promise<void> }>;
	/** Read a captured run's ledger from its isolated dir (by workspace hash). */
	readCapturedLedger: (input: { ledgerRootDir: string; workspacePathHash: string }) => Promise<AgentLedgerEvent[]>;
}

export async function orchestrateReplayEvalAutoCapture(
	input: {
		taskId: string;
		resultBranch: string;
		baselineTreePath: string;
		workflowId: string;
		workspacePathHash: string;
		baselineLedgerRoot: string;
		replayLedgerRoot: string;
	},
	deps: ReplayEvalAutoCaptureDeps,
): Promise<ReplayEvalOutcome> {
	// Capture the BASELINE (current, pre-patch tree) first — before the worktree exists.
	await deps.runScenarioSuite({ treePath: input.baselineTreePath, ledgerRootDir: input.baselineLedgerRoot });
	const captured = await deps.readCapturedLedger({
		ledgerRootDir: input.baselineLedgerRoot,
		workspacePathHash: input.workspacePathHash,
	});
	// Capture the REPLAY (the patched result branch) in an isolated worktree, ALWAYS cleaned up.
	const worktree = await deps.createResultWorktree(input.resultBranch);
	try {
		await deps.runScenarioSuite({ treePath: worktree.path, ledgerRootDir: input.replayLedgerRoot });
		const replayed = await deps.readCapturedLedger({
			ledgerRootDir: input.replayLedgerRoot,
			workspacePathHash: input.workspacePathHash,
		});
		return buildReplayEvalOutcome({
			captured,
			replayed,
			workflowId: input.workflowId,
			taskId: input.taskId,
			workspacePathHash: input.workspacePathHash,
		});
	} finally {
		await worktree.cleanup();
	}
}

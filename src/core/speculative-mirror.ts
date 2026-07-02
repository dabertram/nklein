/**
 * §5.AW opportunistic speculative best-of-N — the pure mirror-tick decision core.
 *
 * User decision (2026-07-02): OPPORTUNISTIC — idle capacity may mirror the current card, best result wins.
 * Given a snapshot of the swarm (running workers, idle models, queued real work, budgets), decide whether an
 * idle model should start a speculative `<taskId>::spec` session mirroring the hardest running card. The tick
 * host (runtime-server) owns the I/O; keeping the decision pure makes the scheduling rules unit-testable.
 *
 * Hard rules encoded here:
 *  - REAL WORK OUTRANKS SPECULATION (§5.AQ e): any queued or overlap-deferred real card vetoes mirroring —
 *    an idle rail that real work is waiting for must never be burned on a spec.
 *  - DIVERSITY IS THE VALUE (§5.0.5 a + the Self-MoA caveat): mirror only onto a model whose lineage is
 *    KNOWN and DIFFERENT from the running worker's — a same-family mirror fails the same way the primary
 *    does, so it is correlated waste, not a hedge.
 *  - ONE MIRROR PER CARD: a card is never speculatively mirrored twice in a run (the arbitration seam only
 *    compares one A against one B).
 */

import { isLineageDiverse } from "./model-lineage";

/** A real (non-synthetic) worker session currently running on the board. */
export interface SpeculativeMirrorRunningWorker {
	taskId: string;
	modelId: string;
	/** Router difficulty estimate for the card (0–100), when known; null sorts last. */
	difficulty: number | null;
	/** Session start (epoch ms), for a stable tie-break: mirror the longest-running card first. */
	startedAt: number | null;
}

/** A loaded model with free capacity this tick (no session, nothing queued on its endpoint). */
export interface SpeculativeMirrorIdleModel {
	modelId: string;
}

export interface SpeculativeMirrorDecisionInput {
	/** Resolved `speculativeBestOfNEnabled`. */
	enabled: boolean;
	/** Resolved `speculativeMaxConcurrentSpecs`. */
	maxConcurrentSpecs: number;
	/** Resolved `speculativeMaxSpecsPerRun`. */
	maxSpecsPerRun: number;
	/** `::spec` sessions currently alive. */
	runningSpecCount: number;
	/** Spec sessions already started this run (lifetime counter, not just alive now). */
	specsStartedThisRun: number;
	/** Real task starts waiting in the start queue (any > 0 vetoes mirroring). */
	queuedRealStartCount: number;
	/** Real cards deferred by overlap/concurrency (any > 0 vetoes mirroring). */
	deferredRealCardCount: number;
	/** Real worker sessions currently running (synthetic `::` sessions must be excluded by the caller). */
	runningWorkers: SpeculativeMirrorRunningWorker[];
	/** Models with free capacity this tick. */
	idleModels: SpeculativeMirrorIdleModel[];
	/** Cards already mirrored once (this run) — never mirrored again. */
	alreadyMirroredTaskIds: ReadonlySet<string>;
}

export type SpeculativeMirrorDecision =
	| { action: "none"; reason: string }
	| { action: "mirror"; taskId: string; workerModelId: string; mirrorModelId: string; reason: string };

/** Difficulty-desc, then longest-running-first, then taskId for full determinism. */
function compareByHardness(a: SpeculativeMirrorRunningWorker, b: SpeculativeMirrorRunningWorker): number {
	const difficultyDelta = (b.difficulty ?? -1) - (a.difficulty ?? -1);
	if (difficultyDelta !== 0) {
		return difficultyDelta;
	}
	const startDelta = (a.startedAt ?? Number.MAX_SAFE_INTEGER) - (b.startedAt ?? Number.MAX_SAFE_INTEGER);
	if (startDelta !== 0) {
		return startDelta;
	}
	return a.taskId.localeCompare(b.taskId);
}

/** Decide whether — and how — to start one speculative mirror this tick. At most one mirror per tick. */
export function decideSpeculativeMirror(input: SpeculativeMirrorDecisionInput): SpeculativeMirrorDecision {
	if (!input.enabled) {
		return { action: "none", reason: "Speculative best-of-N is disabled." };
	}
	if (input.runningSpecCount >= input.maxConcurrentSpecs) {
		return { action: "none", reason: `Concurrent spec ceiling reached (${input.maxConcurrentSpecs}).` };
	}
	if (input.specsStartedThisRun >= input.maxSpecsPerRun) {
		return { action: "none", reason: `Per-run spec budget exhausted (${input.maxSpecsPerRun}).` };
	}
	if (input.queuedRealStartCount > 0) {
		return { action: "none", reason: "Real card(s) queued for capacity — real work outranks speculation." };
	}
	if (input.deferredRealCardCount > 0) {
		return { action: "none", reason: "Real card(s) deferred — real work outranks speculation." };
	}
	if (input.runningWorkers.length === 0) {
		return { action: "none", reason: "No real worker turn is running to mirror." };
	}
	if (input.idleModels.length === 0) {
		return { action: "none", reason: "No idle model with free capacity." };
	}
	const mirrorableWorkers = [...input.runningWorkers]
		.filter((worker) => !input.alreadyMirroredTaskIds.has(worker.taskId))
		.sort(compareByHardness);
	for (const worker of mirrorableWorkers) {
		const diverseIdle = input.idleModels.find((idle) => isLineageDiverse(worker.modelId, idle.modelId));
		if (diverseIdle) {
			return {
				action: "mirror",
				taskId: worker.taskId,
				workerModelId: worker.modelId,
				mirrorModelId: diverseIdle.modelId,
				reason: `Mirror hardest running card (difficulty ${worker.difficulty ?? "unknown"}) onto lineage-diverse idle model ${diverseIdle.modelId}.`,
			};
		}
	}
	return {
		action: "none",
		reason: "No lineage-diverse idle model for any running card (same-family mirrors are correlated waste).",
	};
}

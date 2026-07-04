/**
 * §5.AW opportunistic idle-work ranker — APPROVED (David decision-11, 2026-07-04).
 *
 * When the swarm is genuinely IDLE (no real card is ready-and-waiting or running), spare capacity does value-ahead
 * work. This is the pure priority chooser + the hard veto. It is wired into the live idle path by the opportunistic
 * idle-work sweep ({@link ./opportunistic-idle-work}); the per-kind PICKERS that populate `available` land incrementally
 * — today only `review` has a producer + dispatch, so the other kinds are simply never available yet (see the sweep).
 *
 * Candidate kinds + WHY the order (highest value first when idle):
 *   1. `review`           — a completed-but-unreviewed card is the highest-leverage idle task: reviewing it unblocks
 *                           delivery (turns done work into shipped work). Do this before speculating on future work.
 *   2. `work_ahead`       — prepare the NEXT likely-ready card (fetch its context / pre-plan) so it starts instantly.
 *   3. `deliberation_seed`— pre-seed a family-diverse deliberation for a known HARD upcoming card (§5 pillar: process
 *                           compensates for small models) so its first real turn already has candidate approaches.
 *   4. `spec_mirror`      — reconcile the spec/knowledge from recent merges so the next decompose reads fresh truth.
 *   5. `memory_audit`     — a STRONG idle model re-checks recently-written free-form memory notes (§5.AR basic-memory)
 *                           against the code-graph + the §5.AF ledger, flagging stale/hallucinated ones. The ledger is
 *                           schema-gated harness EVIDENCE, but authored memory is model-written PROSE with no built-in
 *                           verification — this is the strong-model verification pass that keeps that store trustworthy.
 *   6. `context_prep`     — warm caches (repo map, embeddings) for the likely-next work. Cheapest + most speculative,
 *                           so it's the fallback — only when nothing higher-value is available.
 *
 * Proposed HARD VETO: if ANY real queued/active work exists (a ready card awaiting a slot, or a running session),
 * opportunistic work is suppressed ENTIRELY. Real work always wins the resources — opportunistic work never competes
 * with, delays, or preempts a genuine card. It runs ONLY in true idle.
 *
 * Pure + total + deterministic.
 */

export type OpportunisticWorkKind =
	| "review"
	| "work_ahead"
	| "deliberation_seed"
	| "spec_mirror"
	| "memory_audit"
	| "context_prep";

/** The approved priority order (highest-value first). */
export const OPPORTUNISTIC_PRIORITY: readonly OpportunisticWorkKind[] = [
	"review",
	"work_ahead",
	"deliberation_seed",
	"spec_mirror",
	"memory_audit",
	"context_prep",
];

export interface OpportunisticWorkInput {
	/**
	 * The HARD veto: true when real queued/active work exists (a ready card awaiting a slot, OR a running session).
	 * When true, no opportunistic work is chosen — real work owns the capacity.
	 */
	hasRealQueuedWork: boolean;
	/** Which opportunistic kinds have a concrete candidate to act on right now (an empty set ⇒ nothing to do). */
	available: readonly OpportunisticWorkKind[];
}

export interface OpportunisticWorkVerdict {
	/** The chosen opportunistic task, or null (vetoed by real work, or nothing available). */
	chosen: OpportunisticWorkKind | null;
	reason: string;
}

/** Pick the highest-priority AVAILABLE opportunistic task, unless real work vetoes it. Pure. */
export function rankOpportunisticWork(input: OpportunisticWorkInput): OpportunisticWorkVerdict {
	if (input.hasRealQueuedWork) {
		return {
			chosen: null,
			reason: "Real queued/active work exists — opportunistic work is vetoed (real work wins).",
		};
	}
	const available = new Set(input.available);
	for (const kind of OPPORTUNISTIC_PRIORITY) {
		if (available.has(kind)) {
			return { chosen: kind, reason: `Idle — chose the highest-priority available opportunistic task (${kind}).` };
		}
	}
	return { chosen: null, reason: "Idle, but no opportunistic work is available." };
}

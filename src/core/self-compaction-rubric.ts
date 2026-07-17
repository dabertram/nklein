/**
 * F12.6 self-compaction fire/hold rubric — PURE core.
 *
 * "Compaction is a DECISION, not a threshold" (2606.23525): the agent knows WHEN forgetting is safe — a resolved
 * sub-task's scaffolding is dead weight, but mid-derivation state is load-bearing even at high occupancy. This rubric
 * guards the model-callable compaction tool: the MODEL proposes (it called the tool), the RUBRIC disposes (fire only
 * when the stated situation makes forgetting safe), and the automatic budget threshold stays as the fallback for
 * models that never call it. Pure + deterministic over the stated signals.
 */

export interface SelfCompactionSignals {
	/** The agent says a sub-task/milestone just RESOLVED (its working detail is now dead weight). */
	readonly subTaskResolved: boolean;
	/** The agent says it is mid-derivation/mid-edit — earlier steps are still load-bearing. */
	readonly midDerivation: boolean;
	/** The agent reports being stuck/looping — compaction destroys the evidence a recovery pass needs. */
	readonly stuck: boolean;
	/** Context occupancy fraction (0-1) when known; null when the caller has no measure. */
	readonly occupancyFraction: number | null;
}

export interface SelfCompactionVerdict {
	readonly action: "fire" | "hold";
	readonly reason: string;
}

/**
 * Decide fire/hold. Precedence: the UNSAFE states win (mid-derivation, stuck) — a wrong hold costs a little context,
 * a wrong fire costs the derivation; then a resolved sub-task fires (the canonical safe moment) — at trivial
 * occupancy (<25%) it still fires cheaply but the reason notes it was barely needed; a bare request with nothing
 * resolved holds unless occupancy is high (≥70%), where the budget fallback would fire soon anyway.
 */
export function decideSelfCompaction(signals: SelfCompactionSignals): SelfCompactionVerdict {
	if (signals.midDerivation) {
		return {
			action: "hold",
			reason: "Mid-derivation — earlier steps are load-bearing; finish the derivation first.",
		};
	}
	if (signals.stuck) {
		return {
			action: "hold",
			reason: "Stuck/looping — compaction would destroy the evidence a recovery pass needs. Escalate instead.",
		};
	}
	if (signals.subTaskResolved) {
		return {
			action: "fire",
			reason:
				signals.occupancyFraction !== null && signals.occupancyFraction < 0.25
					? "Sub-task resolved — safe to compact (occupancy is low, so the gain is small but the moment is right)."
					: "Sub-task resolved — its working detail is dead weight; compact now.",
		};
	}
	if (signals.occupancyFraction !== null && signals.occupancyFraction >= 0.7) {
		return {
			action: "fire",
			reason: "Nothing newly resolved, but occupancy is high — the budget fallback would fire soon regardless.",
		};
	}
	return {
		action: "hold",
		reason: "Nothing resolved and occupancy is comfortable — keep the context; call again when a sub-task lands.",
	};
}

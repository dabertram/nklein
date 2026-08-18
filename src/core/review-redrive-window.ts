/**
 * Re-drive window guard (bed pair-3b root cause, 2026-08-18). When a review bounce SPENDS a remedy rung —
 * the empty-patch reroute or the W4.2 escalation — the re-drive executes asynchronously (session teardown +
 * model load took ~106s in the field run). In that window the OLD worker can hand off again with byte-identical
 * work; admitting that re-claim as a fresh review round burns the stall rung and parks + re-decomposes a card
 * whose remedy is still in flight (the escalated worker delivered the real artifact 3 minutes after the park).
 *
 * The guard: a bounce that initiates a re-drive records what it judged (fingerprint) and who it judged
 * (session start / model). A subsequent handoff is absorbed — no review round, no stall strike — only when it
 * is provably the PRE-re-drive worker re-claiming the SAME artifact. Anything from the re-driven worker
 * (new session start, or the reroute's target model) is judged normally, so a genuinely stuck escalated
 * worker still reaches the park rung.
 */

export interface PendingRedriveObservation {
	/** The work fingerprint the bouncing round judged (same basis as the runner's evidence fingerprint). */
	fingerprint: string;
	/** `startedAt` of the worker session the bounced round judged; a re-drive restart changes it. */
	bouncedSessionStartedAt: number | null;
	/** Model the bounced worker ran on. */
	bouncedModelId: string | null;
	/** Reroute target model when the re-drive switches models (empty-patch failover); null for same-model re-drives. */
	rerouteTargetModelId: string | null;
	/** Re-claims absorbed so far; capped so a wedged re-drive degrades to the old behavior instead of a livelock. */
	absorbedCount: number;
}

/** After this many absorbed re-claims the guard stands down and the normal review ladder resumes. */
export const MAX_ABSORBED_RECLAIMS = 3;

export type RedriveWindowDecision =
	| { absorb: true; reason: "same_session_reclaim" | "pre_reroute_model_reclaim" }
	| {
			absorb: false;
			reason: "no_observation" | "fingerprint_changed" | "redriven_worker" | "absorb_cap_reached";
	  };

/**
 * Decide whether an incoming review admission is a pre-re-drive re-claim to absorb. Pure: the caller owns the
 * observation store and applies `absorbedCount` bookkeeping when the decision is `absorb`.
 */
export function decideRedriveWindow(input: {
	observation: PendingRedriveObservation | null | undefined;
	incomingFingerprint: string | null;
	incomingSessionStartedAt: number | null;
	incomingModelId: string | null;
}): RedriveWindowDecision {
	const observation = input.observation ?? null;
	if (!observation) {
		return { absorb: false, reason: "no_observation" };
	}
	if (!input.incomingFingerprint || input.incomingFingerprint !== observation.fingerprint) {
		return { absorb: false, reason: "fingerprint_changed" };
	}
	if (observation.absorbedCount >= MAX_ABSORBED_RECLAIMS) {
		return { absorb: false, reason: "absorb_cap_reached" };
	}
	// Same session as the one the bounce judged ⇒ the re-drive (which restarts the session or switches models)
	// has not executed yet; this is the old worker re-claiming the artifact that was already judged.
	if (
		input.incomingSessionStartedAt !== null &&
		observation.bouncedSessionStartedAt !== null &&
		input.incomingSessionStartedAt === observation.bouncedSessionStartedAt
	) {
		return { absorb: true, reason: "same_session_reclaim" };
	}
	// Model-switch reroute pending: a handoff still on the BOUNCED model cannot be the reroute target's work.
	if (
		observation.rerouteTargetModelId !== null &&
		observation.rerouteTargetModelId !== observation.bouncedModelId &&
		input.incomingModelId !== null &&
		input.incomingModelId === observation.bouncedModelId
	) {
		return { absorb: true, reason: "pre_reroute_model_reclaim" };
	}
	return { absorb: false, reason: "redriven_worker" };
}

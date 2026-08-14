/**
 * blockedKind release decisions — PURE core (David's 2026-08-12 decision: enforce + auto-clear).
 *
 * `blockedKind` was display-only: three writers set it, nothing gated on it (the sweep restarted
 * needs_decomposition cards against the same fleet that stranded them), and nothing server-side ever cleared it.
 * The enforcement half lives in the ready sweep (blocked cards are not startable); this core is the CLEAR half —
 * given the card's stamp and the current environment facts, has the blocking condition RESOLVED?
 *
 * Per kind:
 *  - `needs_decomposition` (reshard-stamped, carries `blockedFleetFingerprint`): released when the loaded-fleet
 *    fingerprint CHANGED since the stamp — the fleet moved again, so re-evaluate by unblocking; a still-unfit
 *    card is re-stamped by the same reshard pass that stamped it (a self-correcting loop, no fit model here).
 *    Without a stamped fingerprint the card's release is a DECOMPOSITION (plan-apply completes/replaces it), so
 *    this core never releases it — terminality is its clearer.
 *  - `local_model_required`: released when ANY local model is loaded.
 *  - `agent_sandbox_unavailable`: released when the workspace's sandbox manager reports availability.
 *
 * Pure + total: plain values in, verdict out; the watchdog wiring supplies the environment facts.
 */

export interface BlockedCardFacts {
	blockedKind: "needs_decomposition" | "local_model_required" | "agent_sandbox_unavailable";
	blockedFleetFingerprint?: string | null;
}

export interface BlockedReleaseEnvironment {
	/** Current loaded-fleet fingerprint (null when unknown — unknown never releases). */
	currentFleetFingerprint: string | null;
	/** Any local model loaded right now. */
	anyModelLoaded: boolean;
	/** The workspace's agent sandbox is available. */
	sandboxAvailable: boolean;
}

export interface BlockedReleaseDecision {
	release: boolean;
	reason: string;
}

export function decideBlockedKindRelease(
	card: BlockedCardFacts,
	environment: BlockedReleaseEnvironment,
): BlockedReleaseDecision {
	switch (card.blockedKind) {
		case "needs_decomposition": {
			const stamped = card.blockedFleetFingerprint?.trim();
			if (!stamped) {
				return {
					release: false,
					reason: "needs_decomposition without a fleet stamp is released by a decomposition, not by fleet drift.",
				};
			}
			if (!environment.currentFleetFingerprint) {
				return { release: false, reason: "Current fleet fingerprint unknown — unknown never releases." };
			}
			if (environment.currentFleetFingerprint === stamped) {
				return { release: false, reason: "The loaded fleet is unchanged since the card was stranded." };
			}
			return {
				release: true,
				reason:
					"The loaded fleet changed since the card was stranded — re-evaluating by unblocking (a still-unfit card is re-stamped by the reshard pass).",
			};
		}
		case "local_model_required":
			return environment.anyModelLoaded
				? { release: true, reason: "A local model is loaded again." }
				: { release: false, reason: "No local model is loaded." };
		case "agent_sandbox_unavailable":
			return environment.sandboxAvailable
				? { release: true, reason: "The agent sandbox is available again." }
				: { release: false, reason: "The agent sandbox is still unavailable." };
	}
}

import { propagateTaint, type TaintLabel } from "../core/taint-labels";

/**
 * F2.1 (§5.L/§5.M) — SESSION-persistent chat taint. The gated tool executor's taint window is per-TURN (one
 * executor per turn), but the untrusted content a turn ingests stays in the session's context — verbatim in the
 * recent window or folded into the rolling summary — so the taint must outlive the turn too. This registry keeps
 * each chat session's accumulated labels: the resolver seeds every new turn's executor with them and folds the
 * turn's additions back, so a protected-sink call N turns after a tainted page read is still broker-gated, and
 * summarization can never launder taint BY CONSTRUCTION (labels live at session granularity, not message
 * granularity). Accumulate-only; cleared only when the session itself is deleted (its transcript goes with it).
 *
 * In-memory (mirrors the executor's own window). KNOWN residue for the wiring leaf: a runtime restart clears the
 * registry while the persisted transcript survives — persisting labels alongside the session closes that.
 */

export interface ChatSessionTaintRegistry {
	get: (sessionId: string) => readonly TaintLabel[];
	/** Union `labels` into the session's set (accumulate-only). Returns the folded set. */
	fold: (sessionId: string, labels: readonly TaintLabel[]) => readonly TaintLabel[];
	clear: (sessionId: string) => void;
	clearAll: () => void;
}

export function createChatSessionTaintRegistry(): ChatSessionTaintRegistry {
	const taintBySessionId = new Map<string, readonly TaintLabel[]>();
	return {
		get(sessionId) {
			return taintBySessionId.get(sessionId) ?? [];
		},
		fold(sessionId, labels) {
			if (labels.length === 0) {
				return taintBySessionId.get(sessionId) ?? [];
			}
			const folded = propagateTaint(taintBySessionId.get(sessionId) ?? [], labels);
			taintBySessionId.set(sessionId, folded);
			return folded;
		},
		clear(sessionId) {
			taintBySessionId.delete(sessionId);
		},
		clearAll() {
			taintBySessionId.clear();
		},
	};
}

/** The runtime-wide registry the live chat wiring uses (one process = one chat runtime). */
export const chatSessionTaintRegistry = createChatSessionTaintRegistry();

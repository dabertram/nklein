/**
 * Resolve an observation's outcome across the SESSION/CARD id namespace boundary. PURE — the ONE bridge shared by
 * every observation→outcome join (tool-gate, tool-trust, off-track remedy), extracted from
 * `tool-gate-observation-join` so the other joins stop exact-matching ids that never intersect.
 *
 * Live-found 2026-08-02, on the first real drain: gates emit from a TASK SESSION, whose id is the card id plus a
 * per-session suffix — `devtest-…-1785625582977-1785625755525-5mmhsijz` against card `devtest-…-1785625582977` —
 * while the scheduler's terminal records carry the CARD id. An exact-match join therefore intersected in ZERO rows
 * and always would have: the twelfth instance of the day's defect class, invisible to unit tests whose fixtures
 * matched ids by construction.
 *
 * Audit 2026-08-12 extension: DERIVED session ids (`<cardId>::review`, `<cardId>::spec`, …) observe on behalf of
 * their primary card, so they bridge too — the id is stripped at the first `::` (via the synthetic-task-id helper,
 * never a hand-rolled "::") and resolved as the primary.
 *
 * Precedence: exact match first, then the derived-id strip, then the LONGEST prefix followed by `-`. Longest,
 * because one card id can in principle be a prefix of another (both end in a timestamp); matching the longest
 * candidate makes the choice deterministic and attributes the observation to the most specific card. No match stays
 * UNKNOWN (`undefined`) — never a guess.
 */

import { boardCardIdOfTaskSessionId, isDerivedTaskSessionId } from "./synthetic-task-id";

export function resolveOutcomeForObservation(
	observationTaskId: string,
	outcomeByTaskId: ReadonlyMap<string, boolean>,
): boolean | undefined {
	const exact = outcomeByTaskId.get(observationTaskId);
	if (exact !== undefined) {
		return exact;
	}
	// A derived session (`<cardId>::review` etc.) resolves as its primary card — exact on the stripped id first,
	// then the same prefix walk (the derived suffix can ride a session-shaped id, not only a bare card id).
	const primaryTaskId = isDerivedTaskSessionId(observationTaskId)
		? boardCardIdOfTaskSessionId(observationTaskId)
		: observationTaskId;
	if (primaryTaskId !== observationTaskId) {
		const primaryExact = outcomeByTaskId.get(primaryTaskId);
		if (primaryExact !== undefined) {
			return primaryExact;
		}
	}
	let bestId: string | null = null;
	for (const cardId of outcomeByTaskId.keys()) {
		if (primaryTaskId.startsWith(`${cardId}-`) && (bestId === null || cardId.length > bestId.length)) {
			bestId = cardId;
		}
	}
	return bestId === null ? undefined : outcomeByTaskId.get(bestId);
}

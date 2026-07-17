/**
 * F12.22 progress-ledger stall detector — PURE core.
 *
 * Turn-count loop guards miss the SEMANTIC stall: an agent that keeps busily calling tools while its actual
 * progress state — which files it touches, which plan step it claims, whether anything new gets written — stops
 * changing. This detector fingerprints each turn's PROGRESS-RELEVANT facts and flags a stall when the fingerprint
 * stops evolving across a window, regardless of how varied the busywork looks. The reaction (forced replan, nudge,
 * park) is the caller's; this is the measurement. Complements `edit-thrash-detector` (A→B→A content oscillation)
 * with the broader no-new-state case. Pure + deterministic over the supplied turn records.
 */

export interface TurnProgressRecord {
	/** Files written/edited this turn (empty = a read-only turn). */
	readonly filesWritten: readonly string[];
	/** The focus-chain step the agent claims to be on (null when none). */
	readonly focusStep: string | null;
	/** Whether any verification (test/build/acceptance run) happened this turn. */
	readonly ranVerification: boolean;
}

export interface ProgressStallVerdict {
	readonly stalled: boolean;
	/** Consecutive most-recent turns with an unchanged progress fingerprint. */
	readonly unchangedTurns: number;
	readonly reason: string;
}

function fingerprint(record: TurnProgressRecord): string {
	// Sorted file set + claimed step + verification bit: turns that only vary their READS collapse together —
	// reading differently while writing nothing new IS the stall shape this exists to catch.
	return `${[...record.filesWritten].sort().join(",")}|${record.focusStep ?? ""}|${record.ranVerification ? "v" : ""}`;
}

/**
 * Assess the most recent turns for a semantic stall. Default window 4: four consecutive turns with an identical
 * progress fingerprint AND no writes in the window ⇒ stalled (a stable fingerprint WITH writes is steady progress
 * on one file — legitimate). Fewer records than the window ⇒ never stalled (no evidence, no alarm).
 */
export function assessProgressStall(
	records: readonly TurnProgressRecord[],
	options: { windowTurns?: number } = {},
): ProgressStallVerdict {
	const window = options.windowTurns ?? 4;
	if (records.length < window) {
		return { stalled: false, unchangedTurns: 0, reason: `only ${records.length} turn(s) observed — no verdict.` };
	}
	const recent = records.slice(-window);
	const first = fingerprint(recent[0] as TurnProgressRecord);
	let unchanged = 1;
	for (let index = 1; index < recent.length; index += 1) {
		if (fingerprint(recent[index] as TurnProgressRecord) === first) {
			unchanged += 1;
		} else {
			return { stalled: false, unchangedTurns: 0, reason: "progress fingerprint is still evolving." };
		}
	}
	const anyWrites = recent.some((record) => record.filesWritten.length > 0);
	if (anyWrites) {
		return {
			stalled: false,
			unchangedTurns: unchanged,
			reason: "fingerprint stable but the agent is still writing — steady work, not a stall.",
		};
	}
	return {
		stalled: true,
		unchangedTurns: unchanged,
		reason: `${unchanged} consecutive turns with an identical progress fingerprint and ZERO writes — the agent is circling; force a replan.`,
	};
}

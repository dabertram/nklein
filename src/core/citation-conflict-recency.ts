/**
 * §5.AC recency tie-break — the "prefer newer in conflicts" half of citation verification. Given a group of claims
 * ALREADY declared mutually-conflicting (that judgment — WHICH claims conflict — needs a model and lives elsewhere),
 * pick the newest-dated one as the winner and mark the rest superseded, so a synthesis prefers the fresher release
 * note / advisory / doc when two sources disagree.
 *
 * Sibling to `retrieval-freshness-authority-rank.ts` (recency×authority ranking) and `verifyCitations` (grounding):
 * this resolves a CONFLICT by RECENCY only. PRIME DIRECTIVE #1: DECIDES only — no I/O, no model, no fs; the `now`
 * clock is INJECTED (never `Date.now()`). Pure + deterministic. Tolerant date parsing (Date | ISO string | epoch ms
 * | null) mirroring `retrieval-freshness.ts`; a future-dated claim clamps to `now` (clock skew / a dated-ahead doc
 * must not out-rank a genuinely-newer one); undated claims sort last; ties (equal or both-undated) keep stable input
 * order. Never fabricates a date.
 */

/** A claim in a conflict group — its id plus an optional publication date in any tolerated form. */
export interface RecencyConflictClaim {
	id: string;
	publishedAt?: Date | string | number | null;
}

export interface RecencyConflictResolution {
	/** The newest-dated claim's id, or null when the group is empty. */
	winnerId: string | null;
	/** The other claims' ids (input order), all treated as superseded by the winner. */
	supersededIds: string[];
	/** The winner's effective (future-clamped) publication date as an ISO string, or null when the winner is undated. */
	winnerPublishedIso: string | null;
	/** A short human rail for telemetry / surfacing the decision. */
	reason: string;
}

/** Parse a tolerated date value into a valid Date, or null when unusable (mirrors retrieval-freshness). */
function parseClaimDate(value: Date | string | number | null | undefined): Date | null {
	if (value === null || value === undefined) {
		return null;
	}
	const date = value instanceof Date ? value : new Date(value);
	return Number.isNaN(date.getTime()) ? null : date;
}

/** The claim's EFFECTIVE date for ranking: parsed, then future-clamped to `now` (clock skew must not win). */
function effectiveDateMs(value: Date | string | number | null | undefined, now: Date): number | null {
	const parsed = parseClaimDate(value);
	if (parsed === null) {
		return null;
	}
	return Math.min(parsed.getTime(), now.getTime());
}

/**
 * Resolve an already-grouped conflict by recency: the newest effective date wins; the rest are superseded. Undated
 * claims sort last; ties (equal effective date, or two undated claims) keep stable INPUT order — deterministic and
 * never date-fabricating. `now` is injected for the future-clamp.
 */
export function resolveConflictByRecency(
	conflictingClaims: readonly RecencyConflictClaim[],
	now: Date,
): RecencyConflictResolution {
	if (conflictingClaims.length === 0) {
		return { winnerId: null, supersededIds: [], winnerPublishedIso: null, reason: "no claims to resolve" };
	}

	let winnerIndex = 0;
	let winnerMs = effectiveDateMs(conflictingClaims[0]?.publishedAt, now);
	for (let index = 1; index < conflictingClaims.length; index += 1) {
		const candidateMs = effectiveDateMs(conflictingClaims[index]?.publishedAt, now);
		// A dated candidate beats an undated incumbent; a strictly-newer dated candidate beats a dated incumbent.
		// Equal dates or an undated candidate never displace the earlier winner ⇒ stable input order on ties.
		if (candidateMs !== null && (winnerMs === null || candidateMs > winnerMs)) {
			winnerIndex = index;
			winnerMs = candidateMs;
		}
	}

	const winner = conflictingClaims[winnerIndex];
	const winnerId = winner?.id ?? null;
	const supersededIds = conflictingClaims.filter((_, index) => index !== winnerIndex).map((claim) => claim.id);
	const winnerPublishedIso = winnerMs === null ? null : new Date(winnerMs).toISOString();
	const reason =
		winnerMs === null
			? `no claim in the group of ${conflictingClaims.length} carries a usable date — kept the first as winner by stable order`
			: `"${winnerId}" is the newest (${winnerPublishedIso}) of ${conflictingClaims.length} conflicting claims; ${supersededIds.length} superseded`;

	return { winnerId, supersededIds, winnerPublishedIso, reason };
}

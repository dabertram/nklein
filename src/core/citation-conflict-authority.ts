/**
 * F4.5 — resolve a citation conflict by preferring the newer, MORE-AUTHORITATIVE source, while RETAINING the minority
 * and MARKING genuinely-unresolved conflicts rather than forcing a pick. This is the authority-aware sibling of
 * {@link resolveClaimConflictsBatch} (recency-only): it ranks the conflicting sources through
 * {@link rankByFreshnessAuthority} (the fused recency × authority × optional-relevance score), then:
 *   - if one source clearly wins (its score beats the runner-up by at least `minMargin`), it is the winner and the rest
 *     are `supersededIds` — SUPERSEDED, not discarded, so the minority view is preserved for audit / re-surfacing;
 *   - if the top two are within `minMargin` (no authoritative newer source stands out), the conflict is left
 *     `unresolved` with NO winner and every id retained — the operator/synthesis keeps both rather than trusting a
 *     coin-flip on a material claim.
 *
 * PURE + deterministic: `now` is INJECTED (never `Date.now()`); no I/O. Composes the ranker by import; adds only the
 * margin/unresolved decision on top of it.
 */

import {
	type FreshnessAuthorityOptions,
	type RankableSource,
	rankByFreshnessAuthority,
} from "./retrieval-freshness-authority-rank.js";

export interface ClaimConflictResolution {
	/** The winning source id, or null when the conflict is unresolved (no clear authoritative-newer source). */
	winnerId: string | null;
	/** The other sources' ids — superseded by the winner (retained for audit), or ALL ids when unresolved. */
	supersededIds: string[];
	/** True when no source beat the runner-up by `minMargin`; the conflict is kept, not decided. */
	unresolved: boolean;
	/** Short human rail for telemetry / surfacing the decision. */
	reason: string;
}

export interface ClaimConflictAuthorityOptions extends FreshnessAuthorityOptions {
	/** Minimum fused-score margin (top − runner-up) required to declare a winner. Default 0.05. */
	minMargin?: number;
}

/** Resolve ONE conflict group by fused recency×authority, retaining the minority and flagging no-clear-winner cases. */
export function resolveClaimConflictByAuthority(
	sources: readonly RankableSource[],
	now: Date,
	options: ClaimConflictAuthorityOptions = {},
): ClaimConflictResolution {
	if (sources.length === 0) {
		return { winnerId: null, supersededIds: [], unresolved: false, reason: "empty conflict group" };
	}
	const { minMargin = 0.05, ...rankOptions } = options;
	const ranked = rankByFreshnessAuthority(sources, now, rankOptions);
	const top = ranked[0];
	if (!top) {
		return { winnerId: null, supersededIds: [], unresolved: false, reason: "empty conflict group" };
	}
	if (ranked.length === 1) {
		return { winnerId: top.id, supersededIds: [], unresolved: false, reason: "single source" };
	}
	const runnerUp = ranked[1];
	const margin = top.score - (runnerUp?.score ?? 0);
	if (margin < minMargin) {
		return {
			winnerId: null,
			supersededIds: ranked.map((source) => source.id),
			unresolved: true,
			reason: `no clear winner (top margin ${margin.toFixed(3)} < ${minMargin})`,
		};
	}
	return {
		winnerId: top.id,
		supersededIds: ranked.slice(1).map((source) => source.id),
		unresolved: false,
		reason: `prefer ${top.freshnessVerdict}/${top.trustTier} (score ${top.score.toFixed(3)} vs ${(runnerUp?.score ?? 0).toFixed(3)})`,
	};
}

/** Resolve a BATCH of conflict groups, index-aligned to the input (`result[i]` resolves `groups[i]`); each independently. */
export function resolveClaimConflictsByAuthorityBatch(
	groups: readonly (readonly RankableSource[])[],
	now: Date,
	options: ClaimConflictAuthorityOptions = {},
): ClaimConflictResolution[] {
	return groups.map((group) => resolveClaimConflictByAuthority(group, now, options));
}

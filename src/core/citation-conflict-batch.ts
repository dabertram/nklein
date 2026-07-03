/**
 * §5.AC batch recency tie-break — the "resolve MANY conflict groups at once" fan-out over
 * {@link resolveConflictByRecency}. A synthesis pass often surfaces several INDEPENDENT conflict clusters in one shot
 * (each cluster = a set of claims a model already judged mutually-contradictory); this maps every cluster through the
 * single-group resolver, order-preserving, so each cluster is decided in ISOLATION — group A's winner can never
 * supersede a claim that lives in group B. Composes the single resolver BY IMPORT only; adds no new resolution rule.
 *
 * PRIME DIRECTIVE #1 (inherited from the composed core): DECIDES only — no I/O, no model, no fs; the `now` clock is
 * INJECTED (never `Date.now()`) and threaded unchanged into every group. Pure + deterministic: the output array is
 * positionally aligned to the input (result[i] resolves groups[i]), and an empty group list yields `[]`. All the
 * per-group semantics — future-clamp, undated-last, stable ties, empty-group → `winnerId: null` — are exactly those of
 * {@link resolveConflictByRecency}; this wrapper never reinterprets them.
 */

import {
	type RecencyConflictClaim,
	type RecencyConflictResolution,
	resolveConflictByRecency,
} from "./citation-conflict-recency";

/**
 * Resolve a BATCH of already-grouped conflicts by recency, one resolution per input group, index-aligned to the input
 * (`result[i]` is the resolution of `groups[i]`). Each group is resolved INDEPENDENTLY via
 * {@link resolveConflictByRecency}: no cross-group state, so a winner in one group never appears in another group's
 * `supersededIds`. `now` is injected once and threaded unchanged into every group for the future-clamp. An empty group
 * list returns `[]`; an empty inner group resolves to `{ winnerId: null, supersededIds: [], … }` exactly as the single
 * resolver dictates. Pure + deterministic; never fabricates a date and never mutates its input.
 */
export function resolveClaimConflictsBatch(
	groups: readonly (readonly RecencyConflictClaim[])[],
	now: Date,
): RecencyConflictResolution[] {
	return groups.map((group) => resolveConflictByRecency(group, now));
}

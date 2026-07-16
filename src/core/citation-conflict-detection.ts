/**
 * F4.5 — DETERMINISTIC claim-conflict detection: group a flat list of keyed claims into conflict clusters WITHOUT asking
 * the model to identify the conflicts. The existing batch resolvers ({@link resolveClaimConflictsByAuthorityBatch},
 * {@link resolveClaimConflictsBatch}) take ALREADY-grouped clusters that "a model judged contradictory"; this core
 * produces those clusters mechanically, so synthesis can detect and resolve conflicts even when the model didn't flag
 * them. A cluster is any claim key on which two or more sources assert DIFFERENT values.
 *
 * PURE + deterministic — no I/O, no model, no clock. Order-stable: clusters appear in first-seen claim-key order, and
 * claims within a cluster keep input order. Value/key matching is trim+casefold by default (a claim key or value differing
 * only in whitespace/case is the same claim), overridable for case-sensitive domains.
 */

/** One source's assertion: WHAT it is about (`claimKey`), the asserted `value`, and WHO asserts it (`sourceId`). */
export interface KeyedClaim {
	readonly claimKey: string;
	readonly value: string;
	readonly sourceId: string;
}

/** A detected conflict: one claim key on which the retained claims disagree (≥ 2 distinct values). */
export interface ClaimConflictCluster {
	/** The claim key (as first seen in the input, un-normalized — for display). */
	readonly claimKey: string;
	/** Every claim on this key, input order preserved (the batch resolver decides which source wins). */
	readonly claims: KeyedClaim[];
	/** The distinct asserted values (normalized), first-seen order — the evidence of disagreement. */
	readonly distinctValues: string[];
}

export interface DetectClaimConflictsOptions {
	/** Compare keys AND values case-sensitively (default false — trim + casefold). */
	readonly caseSensitive?: boolean;
}

const normalize = (text: string, caseSensitive: boolean): string => {
	const trimmed = text.trim().replace(/\s+/g, " ");
	return caseSensitive ? trimmed : trimmed.toLowerCase();
};

/**
 * Detect conflict clusters in `claims`: group by (normalized) claim key, keep only keys where the sources assert two or
 * more distinct (normalized) values. Never mutates its input.
 */
export function detectClaimConflicts(
	claims: readonly KeyedClaim[],
	options: DetectClaimConflictsOptions = {},
): ClaimConflictCluster[] {
	const caseSensitive = options.caseSensitive ?? false;
	// Preserve first-seen key order while grouping.
	const order: string[] = [];
	const byKey = new Map<
		string,
		{ displayKey: string; claims: KeyedClaim[]; values: string[]; valueSet: Set<string> }
	>();
	for (const claim of claims) {
		if (typeof claim.claimKey !== "string" || claim.claimKey.trim().length === 0) {
			continue; // a claim with no key can't be grouped
		}
		const key = normalize(claim.claimKey, caseSensitive);
		let bucket = byKey.get(key);
		if (!bucket) {
			bucket = { displayKey: claim.claimKey.trim(), claims: [], values: [], valueSet: new Set() };
			byKey.set(key, bucket);
			order.push(key);
		}
		bucket.claims.push(claim);
		const normValue = normalize(claim.value ?? "", caseSensitive);
		if (!bucket.valueSet.has(normValue)) {
			bucket.valueSet.add(normValue);
			bucket.values.push(normValue);
		}
	}
	const clusters: ClaimConflictCluster[] = [];
	for (const key of order) {
		const bucket = byKey.get(key);
		if (bucket && bucket.values.length >= 2) {
			clusters.push({ claimKey: bucket.displayKey, claims: bucket.claims, distinctValues: bucket.values });
		}
	}
	return clusters;
}

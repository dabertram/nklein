/**
 * Temporal-consistency checker for DATED CLAIMS — the anachronism guard of the "knows today" lighthouse (todo §5.AC).
 *
 * WHY. §5.AC gives the agent an authoritative "now" and `retrieval-freshness.ts` bands a SOURCE's publication age.
 * Neither judges whether a specific CLAIM's asserted temporal validity is consistent with the present. That is the exact
 * failure mode the lighthouse names: a local model reasoning from a stale training prior asserts a claim that is
 * ANACHRONISTIC — it treats a state dated in the FUTURE relative to now as already true ("Apple WWDC 2026 is years
 * away" → so it "hasn't happened"), or keeps repeating a claim whose stated validity horizon has already lapsed
 * ("as of v2 the flag defaults on") long after it EXPIRED. This module takes a claim that carries an `asOf` date (when
 * the claim was true / measured / published) and an optional `validUntil` horizon (when it stops being trustable), and
 * against the injected `now` returns one of three statuses + a plain-language reason the agent can surface:
 *   • `current`       — as-of is at/behind now and (if given) the validity horizon has not passed → safe to assert.
 *   • `stale`         — as-of is in the past AND its `validUntil` horizon is now behind us → the claim EXPIRED; re-verify.
 *   • `anachronistic` — as-of is in the FUTURE relative to now → the claim asserts a state that has not happened yet;
 *                       a temporally-grounded agent must NOT present it as an established fact.
 *
 * A claim with no usable `asOf` date is `undated` (freshness genuinely unknown — treat with caution, don't fabricate a
 * status). `checkClaimsTemporalConsistency` sweeps a batch and buckets them so a synthesis step can drop/flag the
 * anachronistic + expired ones before they reach the user.
 *
 * PRIME DIRECTIVE #1 boundary: this DECIDES only — it performs NO retrieval/egress/I/O/model/UI/fs. Every input (the
 * claim's dates, the current `now`, the grace window) is INJECTED as a plain value. PURE + clock-injected: it never
 * reads `Date.now()`; all math is on UTC calendar days (matching {@link resolveTemporalAwareness} /
 * {@link judgeRetrievedFreshness}) so results never drift with the runtime timezone, and it is fully deterministic +
 * unit-testable. Complements — does not duplicate — `retrieval-freshness.ts` (SOURCE age → freshness band) and
 * `relative-date-resolver.ts` (relative phrase → absolute date, which can FEED the `asOf`/`validUntil` here).
 */

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Temporal-consistency status of a single dated claim relative to the authoritative "now". */
export type ClaimTemporalStatus = "current" | "stale" | "anachronistic" | "undated";

/** A claim whose temporal validity we want to judge. Dates accept `Date` / ISO-or-parseable string / epoch ms / absent. */
export interface DatedClaim {
	/**
	 * When the claim was true / measured / published (its "as-of" instant). Absent/unparseable ⇒ the claim is `undated`.
	 * A claim dated in the FUTURE relative to `now` is `anachronistic` (it asserts a not-yet state as fact).
	 */
	asOf?: Date | string | number | null;
	/**
	 * Optional horizon after which the claim stops being trustable (an explicit expiry / "valid until" the caller knows,
	 * e.g. a scheduled deprecation date or a known next-release date). When this is behind `now`, a past-dated claim is
	 * `stale`. Absent ⇒ the claim carries no expiry and stays `current` as long as it is not future-dated.
	 */
	validUntil?: Date | string | number | null;
}

/** The verdict for one claim: its status, the reason rail, and the resolved dates + whole-day deltas used to decide. */
export interface ClaimTemporalConsistency {
	status: ClaimTemporalStatus;
	/** A short plain-language rail for the agent: assert it, re-verify it, or don't present it as fact yet. */
	reason: string;
	/** The parsed as-of date as `YYYY-MM-DD` (UTC), or null when absent/unparseable. */
	asOfIso: string | null;
	/** The parsed validity horizon as `YYYY-MM-DD` (UTC), or null when absent/unparseable. */
	validUntilIso: string | null;
	/**
	 * Whole UTC days between the as-of date and now: 0 = as-of is today; NEGATIVE = as-of is in the FUTURE (the
	 * anachronism); POSITIVE = as-of is in the past. Null when the claim is `undated`.
	 */
	asOfAgeDays: number | null;
	/**
	 * Whole UTC days from now until the validity horizon: POSITIVE = still valid for that many days; 0 = expires today;
	 * NEGATIVE = expired that many days ago. Null when no `validUntil` was given/parseable.
	 */
	validForDays: number | null;
}

/** Options for the check. `graceDays` tolerates minor clock skew when deciding "is the as-of date in the future?". */
export interface ClaimTemporalConsistencyOptions {
	/**
	 * Days of forward tolerance before an as-of date counts as `anachronistic` (absorbs small clock skew / a claim dated
	 * to the end of "today" in another timezone). Default 0 (any strictly-future as-of is anachronistic). Negative values
	 * are clamped to 0.
	 */
	graceDays?: number;
}

function parseDate(value: Date | string | number | null | undefined): Date | null {
	if (value === null || value === undefined) {
		return null;
	}
	const date = value instanceof Date ? value : new Date(value);
	return Number.isNaN(date.getTime()) ? null : date;
}

function toIso(date: Date): string {
	return date.toISOString().slice(0, 10);
}

/** The integer UTC calendar-day index for a date (days since the epoch, ignoring time-of-day). */
function utcDayNumber(date: Date): number {
	return Math.floor(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) / MS_PER_DAY);
}

/**
 * Signed whole-CALENDAR-day delta `a - b` on the UTC day grid (positive when `a` is a later calendar day). Differencing
 * UTC day-numbers, NOT raw instants: `Math.round((a - b) / MS_PER_DAY)` is only correct when `a` and `b` share a
 * time-of-day. A real wall-clock `now` (arbitrary time) compared against a midnight ISO claim date ("YYYY-MM-DD") would
 * otherwise be off by a day near the boundary — e.g. a tomorrow-dated claim read as "current" instead of anachronistic,
 * or a valid-through-today claim read as "stale" for the afternoon half of the day.
 */
function wholeDayDelta(a: Date, b: Date): number {
	return utcDayNumber(a) - utcDayNumber(b);
}

function reasonFor(
	status: ClaimTemporalStatus,
	asOfAgeDays: number | null,
	validForDays: number | null,
	asOfIso: string | null,
): string {
	switch (status) {
		case "anachronistic": {
			const ahead = asOfAgeDays === null ? 0 : Math.abs(asOfAgeDays);
			return `This claim is dated ${asOfIso} — ${ahead} day${ahead === 1 ? "" : "s"} in the FUTURE relative to today. It asserts a state that has not happened yet; do NOT present it as an established fact (your training prior may make a future-dated event look past).`;
		}
		case "stale": {
			const expiredAgo = validForDays === null ? 0 : Math.abs(validForDays);
			return `This claim's validity horizon passed ${expiredAgo} day${expiredAgo === 1 ? "" : "s"} ago — it has EXPIRED; re-verify against a current source before relying on it.`;
		}
		case "current":
			return `This claim is temporally consistent with today${asOfIso ? ` (as of ${asOfIso})` : ""} — safe to assert.`;
		default:
			return "This claim carries no usable date — its temporal validity is unknown; treat it with caution and prefer a dated, clearly-current source rather than assuming it still holds.";
	}
}

/**
 * Judge one dated claim's temporal consistency against the authoritative `now` (todo §5.AC). Precedence:
 *   1. no parseable `asOf`            → `undated`
 *   2. as-of is in the future (beyond `graceDays`) → `anachronistic` (asserts a not-yet state)
 *   3. `validUntil` given AND behind `now` → `stale` (expired)
 *   4. otherwise                      → `current`
 * Anachronism wins over expiry: a future-dated claim can't also be "expired". PURE + clock-injected.
 */
export function checkClaimTemporalConsistency(
	claim: DatedClaim,
	now: Date,
	options: ClaimTemporalConsistencyOptions = {},
): ClaimTemporalConsistency {
	const grace = Math.max(0, options.graceDays ?? 0);
	const asOf = parseDate(claim.asOf);
	const validUntil = parseDate(claim.validUntil);
	const validUntilIso = validUntil ? toIso(validUntil) : null;
	const validForDays = validUntil ? wholeDayDelta(validUntil, now) : null;

	if (asOf === null) {
		return {
			status: "undated",
			reason: reasonFor("undated", null, validForDays, null),
			asOfIso: null,
			validUntilIso,
			asOfAgeDays: null,
			validForDays,
		};
	}

	const asOfIso = toIso(asOf);
	// Positive = as-of is in the past; negative = as-of is in the future (the anachronism).
	const asOfAgeDays = wholeDayDelta(now, asOf);

	let status: ClaimTemporalStatus;
	if (asOfAgeDays < -grace) {
		status = "anachronistic";
	} else if (validForDays !== null && validForDays < 0) {
		status = "stale";
	} else {
		status = "current";
	}

	return {
		status,
		reason: reasonFor(status, asOfAgeDays, validForDays, asOfIso),
		asOfIso,
		validUntilIso,
		asOfAgeDays,
		validForDays,
	};
}

/** A claim paired with its temporal-consistency verdict; the index preserves the caller's original ordering. */
export interface JudgedClaim<C extends DatedClaim = DatedClaim> {
	index: number;
	claim: C;
	consistency: ClaimTemporalConsistency;
}

/** Batch result: every claim judged (order-preserving) plus id-buckets by status for quick filtering downstream. */
export interface ClaimTemporalConsistencyReport<C extends DatedClaim = DatedClaim> {
	judged: JudgedClaim<C>[];
	/** Indices (into the input array) of `anachronistic` claims — synthesis MUST NOT present these as fact. */
	anachronistic: number[];
	/** Indices of `stale` (expired) claims — re-verify before relying on them. */
	stale: number[];
	/** Indices of `undated` claims — freshness unknown. */
	undated: number[];
	/** True iff at least one claim is `anachronistic` OR `stale` (a temporal problem the agent should act on). */
	hasTemporalProblem: boolean;
}

/**
 * Sweep a batch of dated claims and bucket them by temporal status against `now` (todo §5.AC). Order-preserving; the
 * per-status index lists let a synthesis/citation step drop the anachronistic ones and flag the expired ones before the
 * answer reaches the user. PURE + clock-injected — decides only, never retrieves.
 */
export function checkClaimsTemporalConsistency<C extends DatedClaim>(
	claims: readonly C[],
	now: Date,
	options: ClaimTemporalConsistencyOptions = {},
): ClaimTemporalConsistencyReport<C> {
	const judged: JudgedClaim<C>[] = claims.map((claim, index) => ({
		index,
		claim,
		consistency: checkClaimTemporalConsistency(claim, now, options),
	}));
	const anachronistic = judged.filter((j) => j.consistency.status === "anachronistic").map((j) => j.index);
	const stale = judged.filter((j) => j.consistency.status === "stale").map((j) => j.index);
	const undated = judged.filter((j) => j.consistency.status === "undated").map((j) => j.index);
	return {
		judged,
		anachronistic,
		stale,
		undated,
		hasTemporalProblem: anachronistic.length > 0 || stale.length > 0,
	};
}

/**
 * Whether a status means the agent must NOT present the claim as an established current fact (drives the §5.AC synthesis
 * gate): `anachronistic` (not-yet) and `stale` (expired) both fail; `current` passes; `undated` is left to the caller's
 * caution policy and does NOT by itself block assertion.
 */
export function isClaimAssertable(status: ClaimTemporalStatus): boolean {
	return status === "current" || status === "undated";
}

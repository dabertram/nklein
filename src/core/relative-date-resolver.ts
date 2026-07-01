/**
 * Relative-date resolver — turn a relative temporal phrase into an absolute date against the authoritative "now"
 * (todo §5.AC, the "knows today" lighthouse).
 *
 * WHY. Temporal awareness (§5.AC) gives the agent an authoritative current date; the counterpart it needs is the
 * ability to READ relative dates that appear in a user's request ("what changed in the last 3 days") or in a retrieved
 * document ("updated yesterday", "posted 2 weeks ago") and pin them to an ABSOLUTE calendar date. That absolute date is
 * exactly what the §5.AC freshness judge (`judgeRetrievedFreshness`) expects as `publishedAt` — so this closes the loop:
 * a source that only says "3 days ago" can be banded for freshness once resolved against the trusted host clock. Local
 * models frequently mis-resolve relative dates from a stale training prior (they don't know what "today" is); resolving
 * deterministically host-side removes that failure mode.
 *
 * WHAT. {@link resolveRelativeDate}(phrase, now) → an absolute `YYYY-MM-DD` (UTC) plus how the phrase was understood, or
 * a null match when the phrase carries no recognisable relative-date cue. It covers the high-value, unambiguous cases:
 *   • named day offsets — "today" / "tonight" / "tomorrow" / "yesterday" / "the day before yesterday" / "the day after
 *     tomorrow";
 *   • N-unit offsets — "3 days ago" / "in 2 weeks" / "2 months ago" / "1 year ago" / "a week ago" ("a"/"an" = 1);
 *   • last/next weekday — "last Tuesday" (the most recent past Tuesday, strictly before today) / "next Friday" (the
 *     soonest future Friday, strictly after today);
 *   • period anchors — "this week/month/year" → the period start; "last week/month/year" & "next week/month/year".
 *
 * Deliberately CONSERVATIVE: an unrecognised or genuinely ambiguous phrase returns `null` rather than a guess, so a
 * caller never records a fabricated date. {@link resolveRelativeDatesInText} sweeps free text and returns every distinct
 * relative-date phrase it can pin, so a retrieved snippet can be scanned without the caller writing its own regex.
 *
 * PURE + clock-injected — never reads `Date.now()`, no I/O, no model calls; every mapping is fully deterministic and
 * computed in UTC (matching {@link resolveTemporalAwareness}) so results don't drift with the runtime's timezone.
 */

/** Month/day calendar math is done on UTC calendar fields so results never depend on the runtime timezone. */
const MS_PER_DAY = 24 * 60 * 60 * 1000;

const WEEKDAY_NAMES = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"] as const;

/** The unit of a resolved relative date — how far the phrase reaches and at what granularity. */
export type RelativeDateUnit = "day" | "week" | "month" | "year";

/** A successfully-resolved relative date. `dateIso` is the absolute UTC day (`YYYY-MM-DD`) the phrase points at. */
export interface ResolvedRelativeDate {
	/** Absolute date the phrase resolves to, as `YYYY-MM-DD` (UTC). */
	dateIso: string;
	/** The coarsest unit the phrase named — a period anchor resolves to that period's START day. */
	unit: RelativeDateUnit;
	/**
	 * Signed direction relative to `now`: negative = past, 0 = today/this-period, positive = future. Useful to a caller
	 * that only wants past dates (retrieved content is almost always dated in the past).
	 */
	direction: -1 | 0 | 1;
	/** The exact input substring that matched, lower-cased — for debugging / surfacing what was understood. */
	matchedText: string;
}

// ── UTC calendar helpers ────────────────────────────────────────────────────

function toIso(date: Date): string {
	return date.toISOString().slice(0, 10);
}

/** A UTC-midnight `Date` for the calendar day `now` falls on — the anchor for every day-granular computation. */
function utcStartOfDay(now: Date): Date {
	return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function addDays(day: Date, n: number): Date {
	return new Date(day.getTime() + n * MS_PER_DAY);
}

/** Add whole calendar months, clamping the day-of-month (e.g. Jan 31 + 1 month → Feb 28/29). */
function addMonths(day: Date, n: number): Date {
	const y = day.getUTCFullYear();
	const m = day.getUTCMonth() + n;
	const d = day.getUTCDate();
	const targetYear = y + Math.floor(m / 12);
	const targetMonth = ((m % 12) + 12) % 12;
	const lastOfMonth = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
	return new Date(Date.UTC(targetYear, targetMonth, Math.min(d, lastOfMonth)));
}

function startOfMonth(day: Date): Date {
	return new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), 1));
}

function startOfYear(day: Date): Date {
	return new Date(Date.UTC(day.getUTCFullYear(), 0, 1));
}

/** Monday-based week start (ISO weeks begin on Monday). */
function startOfWeek(day: Date): Date {
	const dow = day.getUTCDay(); // 0=Sun..6=Sat
	const backToMonday = (dow + 6) % 7; // Mon→0, Sun→6
	return addDays(day, -backToMonday);
}

function directionOf(offsetDays: number): -1 | 0 | 1 {
	return offsetDays < 0 ? -1 : offsetDays > 0 ? 1 : 0;
}

function directionFromStep(step: number): -1 | 0 | 1 {
	return step < 0 ? -1 : step > 0 ? 1 : 0;
}

// ── Vocabulary ──────────────────────────────────────────────────────────────

/** Fixed named-day phrases → whole-day offset from today. Longer phrases first so they win the match. */
const NAMED_DAY_OFFSETS: ReadonlyArray<readonly [phrase: string, offset: number]> = [
	["the day before yesterday", -2],
	["the day after tomorrow", 2],
	["yesterday", -1],
	["tomorrow", 1],
	["tonight", 0],
	["today", 0],
];

const UNIT_WORD: Record<string, RelativeDateUnit> = {
	day: "day",
	days: "day",
	week: "week",
	weeks: "week",
	month: "month",
	months: "month",
	year: "year",
	years: "year",
};

// ── Numeric N-unit offsets ("3 days ago", "in 2 weeks", "a month ago") ───────

const N_UNIT_AGO = /\b(\d+|a|an)\s+(day|days|week|weeks|month|months|year|years)\s+ago\b/i;
const N_UNIT_FUTURE = /\bin\s+(\d+|a|an)\s+(day|days|week|weeks|month|months|year|years)\b/i;

function parseCount(token: string): number {
	const lower = token.toLowerCase();
	return lower === "a" || lower === "an" ? 1 : Number.parseInt(lower, 10);
}

function shiftByUnit(anchor: Date, unit: RelativeDateUnit, n: number): Date {
	switch (unit) {
		case "day":
			return addDays(anchor, n);
		case "week":
			return addDays(anchor, n * 7);
		case "month":
			return addMonths(anchor, n);
		case "year":
			return addMonths(anchor, n * 12);
	}
}

function resolveNUnit(text: string, today: Date): ResolvedRelativeDate | null {
	const ago = N_UNIT_AGO.exec(text);
	if (ago) {
		const n = parseCount(ago[1] as string);
		const unit = UNIT_WORD[(ago[2] as string).toLowerCase()] as RelativeDateUnit;
		const date = shiftByUnit(today, unit, -n);
		return { dateIso: toIso(date), unit, direction: n === 0 ? 0 : -1, matchedText: ago[0].toLowerCase() };
	}
	const future = N_UNIT_FUTURE.exec(text);
	if (future) {
		const n = parseCount(future[1] as string);
		const unit = UNIT_WORD[(future[2] as string).toLowerCase()] as RelativeDateUnit;
		const date = shiftByUnit(today, unit, n);
		return { dateIso: toIso(date), unit, direction: n === 0 ? 0 : 1, matchedText: future[0].toLowerCase() };
	}
	return null;
}

// ── last/next weekday ("last Tuesday", "next Friday") ────────────────────────

const LAST_NEXT_WEEKDAY = /\b(last|next)\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/i;

function resolveLastNextWeekday(text: string, today: Date): ResolvedRelativeDate | null {
	const m = LAST_NEXT_WEEKDAY.exec(text);
	if (!m) {
		return null;
	}
	const dir = (m[1] as string).toLowerCase() === "last" ? -1 : 1;
	const targetDow = WEEKDAY_NAMES.indexOf((m[2] as string).toLowerCase() as (typeof WEEKDAY_NAMES)[number]);
	const todayDow = today.getUTCDay();
	// "last X" = the most recent PAST X strictly before today; "next X" = the soonest FUTURE X strictly after today.
	const delta = dir === -1 ? -((todayDow - targetDow + 7) % 7 || 7) : (targetDow - todayDow + 7) % 7 || 7;
	// (delta is already strictly non-zero: `|| 7` maps a same-weekday match to a full week away.)
	const date = addDays(today, delta);
	return { dateIso: toIso(date), unit: "day", direction: dir, matchedText: m[0].toLowerCase() };
}

// ── period anchors ("this/last/next week/month/year") ────────────────────────

const PERIOD_ANCHOR = /\b(this|last|next)\s+(week|month|year)\b/i;

function resolvePeriodAnchor(text: string, today: Date): ResolvedRelativeDate | null {
	const m = PERIOD_ANCHOR.exec(text);
	if (!m) {
		return null;
	}
	const which = (m[1] as string).toLowerCase();
	const unit = (m[2] as string).toLowerCase() as "week" | "month" | "year";
	const step = which === "this" ? 0 : which === "last" ? -1 : 1;
	// Resolve to the START of the target period so the absolute date is stable & unambiguous.
	let anchor: Date;
	if (unit === "week") {
		anchor = startOfWeek(addDays(today, step * 7));
	} else if (unit === "month") {
		anchor = startOfMonth(addMonths(today, step));
	} else {
		anchor = startOfYear(addMonths(today, step * 12));
	}
	return { dateIso: toIso(anchor), unit, direction: directionFromStep(step), matchedText: m[0].toLowerCase() };
}

// ── named single-day phrases ─────────────────────────────────────────────────

function resolveNamedDay(text: string, today: Date): ResolvedRelativeDate | null {
	for (const [phrase, offset] of NAMED_DAY_OFFSETS) {
		if (new RegExp(`\\b${phrase.replace(/ /g, "\\s+")}\\b`, "i").test(text)) {
			return {
				dateIso: toIso(addDays(today, offset)),
				unit: "day",
				direction: directionOf(offset),
				matchedText: phrase,
			};
		}
	}
	return null;
}

/**
 * Resolve a single relative-date phrase to an absolute UTC day against `now`. Returns `null` when the phrase carries no
 * recognisable relative-date cue (the caller should NOT fabricate a date). When multiple cue kinds could match, the
 * MORE-SPECIFIC one wins in this precedence: explicit N-unit ("3 days ago") → last/next weekday → period anchor → named
 * single-day word — so "the day after tomorrow" isn't mis-read as "tomorrow", and "in 2 weeks" beats a stray "week".
 */
export function resolveRelativeDate(phrase: string, now: Date): ResolvedRelativeDate | null {
	const text = phrase.toLowerCase();
	const today = utcStartOfDay(now);
	return (
		resolveNUnit(text, today) ??
		resolveLastNextWeekday(text, today) ??
		resolvePeriodAnchor(text, today) ??
		resolveNamedDay(text, today)
	);
}

// ── free-text sweep ──────────────────────────────────────────────────────────

/**
 * Combined scanner that finds EVERY distinct relative-date phrase in free text (a user request or a retrieved snippet)
 * and resolves each against `now`. Matches are returned in the order they appear; a phrase resolving to the same
 * `matchedText` twice is reported once. Handy for pinning "updated 3 days ago … see also yesterday's post" without the
 * caller writing its own regex. Non-overlapping by construction (each global regex advances past its own match).
 */
export function resolveRelativeDatesInText(text: string, now: Date): ResolvedRelativeDate[] {
	const today = utcStartOfDay(now);
	const lower = text.toLowerCase();
	const found: ResolvedRelativeDate[] = [];
	const seen = new Set<string>();

	const patterns: ReadonlyArray<{ re: RegExp; resolve: (m: string) => ResolvedRelativeDate | null }> = [
		{ re: new RegExp(N_UNIT_AGO, "gi"), resolve: (s) => resolveNUnit(s, today) },
		{ re: new RegExp(N_UNIT_FUTURE, "gi"), resolve: (s) => resolveNUnit(s, today) },
		{ re: new RegExp(LAST_NEXT_WEEKDAY, "gi"), resolve: (s) => resolveLastNextWeekday(s, today) },
		{ re: new RegExp(PERIOD_ANCHOR, "gi"), resolve: (s) => resolvePeriodAnchor(s, today) },
	];
	for (const { re, resolve } of patterns) {
		for (const match of lower.matchAll(re)) {
			const resolved = resolve(match[0]);
			if (resolved && !seen.has(resolved.matchedText)) {
				seen.add(resolved.matchedText);
				found.push(resolved);
			}
		}
	}
	// Named single-day words are matched last so a compound phrase (e.g. "the day after tomorrow") already consumed its
	// text; only add a bare "today/tomorrow/yesterday" when it wasn't part of an already-recorded phrase.
	for (const [phrase, offset] of NAMED_DAY_OFFSETS) {
		const re = new RegExp(`\\b${phrase.replace(/ /g, "\\s+")}\\b`, "gi");
		if (re.test(lower) && !found.some((f) => f.matchedText.includes(phrase))) {
			if (!seen.has(phrase)) {
				seen.add(phrase);
				found.push({
					dateIso: toIso(addDays(today, offset)),
					unit: "day",
					direction: directionOf(offset),
					matchedText: phrase,
				});
			}
		}
	}
	return found;
}

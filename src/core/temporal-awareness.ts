/**
 * Intrinsic temporal awareness — the "knows today" lighthouse (todo §5.AC).
 *
 * Local models reason from a training-cutoff prior with no authoritative "now", so they hallucinate that dated events
 * are still in the future ("Apple WWDC 2026 is years away") or that the present is the future. !Klein fixes this by
 * injecting the REAL current date/time (from the trusted host clock) into every agent context, framed as ground truth
 * that overrides the model's stale date priors — and as the yardstick for judging whether retrieved online info is
 * fresh enough or worth searching further.
 *
 * Pure + clock-injected (never reads `Date.now()` itself) so it is deterministic and fully testable. Computed in UTC so
 * the rail is stable regardless of where the runtime runs; the human label notes UTC explicitly.
 */

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;
const MONTHS = [
	"January",
	"February",
	"March",
	"April",
	"May",
	"June",
	"July",
	"August",
	"September",
	"October",
	"November",
	"December",
] as const;

export interface TemporalAwareness {
	/** Full ISO-8601 instant, e.g. `2026-06-26T21:05:00.000Z`. */
	iso: string;
	/** Human label, e.g. `Friday, 26 June 2026, 21:05 UTC`. */
	human: string;
	weekday: string;
	year: number;
	/** `YYYY-MM-DD` (UTC). */
	todayIso: string;
	tomorrowIso: string;
	yesterdayIso: string;
}

function toDateIso(date: Date): string {
	return date.toISOString().slice(0, 10);
}

function addUtcDays(date: Date, days: number): Date {
	return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

/** Distil a `Date` into the authoritative temporal facts (UTC). */
export function resolveTemporalAwareness(now: Date): TemporalAwareness {
	const weekday = WEEKDAYS[now.getUTCDay()];
	const day = now.getUTCDate();
	const month = MONTHS[now.getUTCMonth()];
	const year = now.getUTCFullYear();
	const hh = String(now.getUTCHours()).padStart(2, "0");
	const mm = String(now.getUTCMinutes()).padStart(2, "0");
	return {
		iso: now.toISOString(),
		human: `${weekday}, ${day} ${month} ${year}, ${hh}:${mm} UTC`,
		weekday,
		year,
		todayIso: toDateIso(now),
		tomorrowIso: toDateIso(addUtcDays(now, 1)),
		yesterdayIso: toDateIso(addUtcDays(now, -1)),
	};
}

/** Temporal-block precision. `"date"` (default) is cache-stable to the day; `"datetime"` adds the wall-clock time. */
export type TemporalGranularity = "date" | "datetime";

// The freshness framing is identical across granularities — the model must treat the date as ground truth that
// overrides its training-cutoff priors and use it to judge online-info freshness.
const TEMPORAL_FRESHNESS_FRAMING: readonly string[] = [
	"IMPORTANT: Your training data has a cutoff in the PAST relative to the date above. Do NOT assume that events,",
	"releases, papers, or versions dated on or before this date are still in the future or have not happened — the",
	"date above is ground truth and overrides any date assumptions from your training. When you use information from",
	"online sources or your own memory, judge its freshness against this current date and prefer the most up-to-date",
	"sources; if something you recall is likely outdated, say so and search for newer information.",
];

/**
 * The injectable temporal system-prompt block. Framed so the model treats the date as ground truth that OVERRIDES its
 * training-cutoff priors and uses it to judge online-info freshness (todo §5.AC). Wire it into agent + chat turns —
 * relevance-gated via {@link isTemporalContextRelevant} (§5.AE JIT composition).
 *
 * DEFAULT granularity is `"date"` (date-only) — the §5.AQ-D cache-aware refinement: when this block IS injected it sits
 * high in the prompt, so a full wall-clock timestamp would change every MINUTE and force a full prefix re-prefill on
 * every turn (the openclaw #19892 class of cache outage). Date-only changes at most DAILY, so the cache survives within
 * the day. Pass `granularity: "datetime"` ONLY for the rare turn that genuinely needs the wall-clock time.
 */
export function buildTemporalAwarenessPrompt(now: Date, options: { granularity?: TemporalGranularity } = {}): string {
	const t = resolveTemporalAwareness(now);
	if (options.granularity === "datetime") {
		return [
			"<current_datetime>",
			`Authoritative current date/time (ground truth from the system clock): ${t.iso} — ${t.human}.`,
			`Today is ${t.todayIso}; tomorrow is ${t.tomorrowIso}; yesterday was ${t.yesterdayIso}; the current year is ${t.year}.`,
			...TEMPORAL_FRESHNESS_FRAMING,
			"</current_datetime>",
		].join("\n");
	}
	// Default: DATE-ONLY (cache-stable to the day) — no wall-clock time → no per-minute prefix churn.
	return [
		"<current_date>",
		`Authoritative current date (ground truth from the system clock): ${t.todayIso} (${t.weekday}); the current year is ${t.year}.`,
		`Today is ${t.todayIso}; tomorrow is ${t.tomorrowIso}; yesterday was ${t.yesterdayIso}.`,
		...TEMPORAL_FRESHNESS_FRAMING,
		"</current_date>",
	].join("\n");
}

/**
 * Temporal/freshness markers that signal the date block is worth its tokens (todo §5.AE — just-in-time prompt
 * composition). Deliberately curated to the words where knowing "now" actually helps: explicit time references and
 * knowledge-freshness words. Bare common code-speak ("now"/"current"/"currently") is excluded — too frequent in
 * ordinary coding prose to be a useful signal.
 */
const TEMPORAL_RELEVANCE_PATTERN =
	/\b(?:today|tonight|tomorrow|yesterday|right now|as of|nowadays|latest|newest|recent(?:ly)?|up[ -]to[ -]date|out[ -]?dated|deprecated|this (?:year|month|week)|last (?:year|month|week)|next (?:year|month|week)|version|releases?|released|news|upcoming|20[2-9]\d)\b/i;

/** Roles for which the date is intrinsically relevant (retrieval/freshness work) — extended by §5.AE's role catalog. */
const TEMPORALLY_RELEVANT_ROLES: ReadonlySet<string> = new Set(["retriever", "researcher"]);

/**
 * Whether the §5.AC temporal/date fragment is worth injecting for this turn (todo §5.AE). The date grounds a
 * retrieval/freshness/temporal task but is dead weight on a plain coding task, so rather than blanket-injecting it into
 * every prompt (the token waste the user flagged), gate it on a relevance signal: a temporally-relevant role, or a
 * temporal/freshness marker in the task text. Deliberately INCLUSIVE — a few false-positive tokens cost less than
 * missing the date where it matters; a prompt with no temporal signal at all (the common coding case) correctly skips it.
 */
export function isTemporalContextRelevant(input: { text?: string | null; role?: string | null }): boolean {
	if (input.role && TEMPORALLY_RELEVANT_ROLES.has(input.role)) {
		return true;
	}
	const text = input.text?.trim();
	return text ? TEMPORAL_RELEVANCE_PATTERN.test(text) : false;
}

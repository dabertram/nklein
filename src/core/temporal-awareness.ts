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

/**
 * The injectable system-prompt block. Wrapped in a `<current_datetime>` tag so it is unmistakable, and framed so the
 * model treats it as ground truth that OVERRIDES its training-cutoff date priors — and uses it to judge online-info
 * freshness. Wire this into every agent + chat turn (todo §5.AC).
 */
export function buildTemporalAwarenessPrompt(now: Date): string {
	const t = resolveTemporalAwareness(now);
	return [
		"<current_datetime>",
		`Authoritative current date/time (ground truth from the system clock): ${t.iso} — ${t.human}.`,
		`Today is ${t.todayIso}; tomorrow is ${t.tomorrowIso}; yesterday was ${t.yesterdayIso}; the current year is ${t.year}.`,
		"IMPORTANT: Your training data has a cutoff in the PAST relative to the date above. Do NOT assume that events,",
		"releases, papers, or versions dated on or before this date are still in the future or have not happened — the",
		"date above is ground truth and overrides any date assumptions from your training. When you use information from",
		"online sources or your own memory, judge its freshness against this current date and prefer the most up-to-date",
		"sources; if something you recall is likely outdated, say so and search for newer information.",
		"</current_datetime>",
	].join("\n");
}

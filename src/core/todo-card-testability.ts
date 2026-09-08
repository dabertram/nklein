import type { RuntimeTaskTestability } from "./board-api-contract";

/**
 * Derive a backlog card's TESTABILITY from the todo entry that produced it (F2.36 (c)).
 *
 * !Klein's test-driven gate requires a test change for testable work. That is the right default and it is wrong
 * for a slice of the backlog: an entry that records a decision, writes documentation, or waits on something only
 * a human can do has nothing to assert, and putting it through the gate makes a worker either invent a
 * meaningless test or loop until it parks.
 *
 * ── THE DEFAULT IS TESTABLE, AND THAT IS DELIBERATE ──
 * A wrong `not_testable` is far more expensive than a wrong `testable`. It silently exempts real product work
 * from the one gate that proves it works, and nothing downstream will ever question it. A wrong `testable` costs
 * a worker one conversation about why there is no test to write. So this only answers `not_testable` on an
 * explicit signal, and every answer carries the phrase it matched — an unexplained exemption is indistinguishable
 * from a bug.
 */

export interface TodoCardTestabilityVerdict {
	testability: RuntimeTaskTestability;
	/** Why, naming the matched signal. Empty for the default. */
	reason: string;
}

/**
 * Signals that an entry has nothing a test could assert. Each is a phrase the backlog actually uses, not a guess:
 * over-broad patterns here are how a real item gets quietly exempted.
 */
const NOT_TESTABLE_SIGNALS: ReadonlyArray<{ pattern: RegExp; reason: string }> = [
	{ pattern: /\bdocumentation[- ]only\b|\bdocs[- ]only\b/iu, reason: "documentation-only work" },
	{ pattern: /\brecord (?:the )?decision\b|\bdecision (?:note|record)\b/iu, reason: "records a decision" },
	{ pattern: /\bresearch(?:ed)?[- ](?:only|note|writeup|write-up)\b/iu, reason: "research writeup" },
	{
		pattern: /\bblocked on (?:network|hardware|credentials?|consent)\b/iu,
		reason: "blocked on something only the operator can do",
	},
	{ pattern: /\bDavid-deferred\b|\bawaiting David\b/iu, reason: "deferred to the operator" },
	{
		pattern: /\bneeds? (?:Apple|Windows) (?:signing )?credentials\b/iu,
		reason: "needs credentials nobody here holds",
	},
	{ pattern: /\bmanual (?:verification|check) only\b/iu, reason: "manual verification only" },
];

/**
 * The EXPLICIT declaration, and the one that should normally be used.
 *
 * Keyword sniffing over a backlog is guesswork dressed as a rule: the first version of this matched phrases that
 * appear nowhere in the actual file, so it read well and did nothing. The codebase already has the better answer
 * — a card declares its testability upfront with a reason (F1.34b) — so a todo entry says it in its own words:
 *
 *     *(not testable: the rebuild is an operational action on a real connection)*
 */
const EXPLICIT_MARKER = /\(not testable:\s*([^)]+)\)/iu;

export function deriveTodoCardTestability(text: string): TodoCardTestabilityVerdict {
	const declared = EXPLICIT_MARKER.exec(text);
	if (declared) {
		return { testability: "not_testable", reason: declared[1].trim() };
	}
	for (const signal of NOT_TESTABLE_SIGNALS) {
		if (signal.pattern.test(text)) {
			return { testability: "not_testable", reason: `todo entry says: ${signal.reason}` };
		}
	}
	return { testability: "testable", reason: "" };
}

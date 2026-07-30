import { globSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * P23.9 — the Dschinn/!Klein boundary, enforced MECHANICALLY instead of by reviewer memory.
 *
 * ── THE BOUNDARY ──
 * Dschinn owns portfolio decisions, business operations, financial governance, owner policy, opportunity research
 * and tool selection. **!Klein owns software planning, implementation, review, testing and delivery**, and
 * `KleinAdapter` translates between them. The rule this file enforces: *finance/marketing/"universal agent"
 * machinery must never leak into !Klein's core.*
 *
 * ── WHY A TEST AND NOT A CONVENTION ──
 * A boundary held only by review is held only while the reviewer remembers it. This one is currently CLEAN — the
 * check was written when zero violations existed — so it is a RATCHET that keeps a clean boundary clean, not a
 * cleanup task. That is the cheapest moment to add one, and the only moment at which it costs nothing.
 *
 * ── WHY IT MATCHES SYMBOLS, NOT WORDS ──
 * Leakage is STRUCTURAL, not lexical. A `PortfolioDecision` interface or a `computeRevenue()` in `src/core` is the
 * boundary breaking; the word "marketing" inside a sentence in a comment is not — and two such sentences exist
 * today, both legitimate ("not worth the exposure for marketing videos", "never a marketing claim"). A raw text
 * scan would flag those, and a check that cries wolf on prose gets an allow-list bolted on until it means nothing.
 * Matching DECLARED IDENTIFIERS keeps the signal exactly where the concept would actually enter the code.
 */

/**
 * Vocabulary that belongs to Dschinn's domain, never !Klein's.
 *
 * Deliberately about BUSINESS concepts rather than anything merely commercial-sounding: !Klein legitimately
 * reasons about token COST and model BUDGETS, so "cost" and "budget" are not on this list and must not be added.
 * The test is worthless the moment it starts flagging things !Klein is supposed to do.
 *
 * ⚠️ "campaign" was on this list for about a minute and is deliberately OFF it. The first run flagged eight
 * symbols in `aider-polyglot-campaign.ts` — !Klein runs BENCHMARK campaigns, and the word is core vocabulary here
 * (the whole G6.8a evaluation effort is "the campaign"). It is a marketing term only in Dschinn's dialect, and a
 * boundary check that flags a domain's own vocabulary is the exact wolf-crying this file's header warns about.
 * Ambiguous words do not belong on this list; only terms that are unambiguously business-side do.
 *
 * ⚠️ "ownerPolicy" was removed for the same reason. It flagged `model-research-policy.ts`, where `ownerPolicy`
 * means *the primary-source policy for a model's PUBLISHER namespace* (a GitHub or Hugging Face owner) — ordinary
 * software vocabulary, nothing to do with Dschinn's owner governance. No identifier-level rule can separate those
 * two senses, so the term cannot serve as a boundary signal at all.
 *
 * **Two of the first eleven candidate terms were false positives.** That is the argument for keeping this list
 * short and unambiguous rather than thorough: each bad term costs a real symbol its name, or costs the check its
 * credibility.
 */
const DSCHINN_DOMAIN_TERMS: readonly string[] = [
	"portfolio",
	"invoice",
	"revenue",
	"profit",
	"pricing",
	"shareholder",
	"marketing",
	"financialGovernance",
	"businessOperation",
];

/** Declaration forms that introduce a NAME into !Klein's code. */
const DECLARATION_PATTERN = /\b(?:function|const|let|var|class|interface|type|enum)\s+([A-Za-z_$][A-Za-z0-9_$]*)/g;

function declaredIdentifiers(source: string): string[] {
	return [...source.matchAll(DECLARATION_PATTERN)].map((match) => match[1] as string);
}

describe("Dschinn/!Klein boundary", () => {
	const files = globSync("src/**/*.ts");

	it("finds source to check (a silently empty glob would pass forever)", () => {
		// The failure mode of every file-scanning test: the glob breaks, zero files are read, and the assertion
		// passes vacuously while checking nothing.
		expect(files.length).toBeGreaterThan(100);
	});

	it("no !Klein symbol is named after a Dschinn-domain concept", () => {
		const violations: string[] = [];
		for (const file of files) {
			const identifiers = declaredIdentifiers(readFileSync(file, "utf8"));
			for (const identifier of identifiers) {
				const lowered = identifier.toLowerCase();
				for (const term of DSCHINN_DOMAIN_TERMS) {
					if (lowered.includes(term.toLowerCase())) {
						violations.push(`${file}: ${identifier} (matches "${term}")`);
					}
				}
			}
		}
		expect(
			violations,
			`Dschinn-domain concepts have leaked into !Klein's core:\n${violations.join("\n")}\n\n` +
				"!Klein owns software planning, implementation, review, testing and delivery. Business/finance " +
				"machinery belongs to Dschinn, which should CONSUME !Klein's evidence rather than reconstruct its " +
				"execution internals. If this is a genuine !Klein concern, rename it to describe the software " +
				"concern; if it is a Dschinn concern, it belongs behind KleinAdapter.",
		).toEqual([]);
	});

	it("the term list stays about BUSINESS concepts, not anything commercial-sounding", () => {
		// !Klein legitimately reasons about token cost and model budgets. If those ever join the list, the check
		// starts flagging !Klein doing its own job, and the next person to hit it will (correctly) delete it.
		// "campaign" and "ownerpolicy" are listed because both were TRIED and REMOVED: !Klein runs benchmark
		// campaigns, and `ownerPolicy` means a model publisher's namespace policy. Re-adding either would flag
		// legitimate symbols on the next run.
		for (const forbidden of ["cost", "budget", "spend", "token", "campaign", "ownerpolicy"]) {
			expect(
				DSCHINN_DOMAIN_TERMS.map((term) => term.toLowerCase()),
				`"${forbidden}" is a legitimate !Klein concern and must not be treated as a boundary violation`,
			).not.toContain(forbidden);
		}
	});
});

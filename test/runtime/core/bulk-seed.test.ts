import { describe, expect, it } from "vitest";
import { BULK_SEED_MAX_INPUTS, parseBulkInputs, planBulkSeed, renderBulkTemplate } from "../../../src/core/bulk-seed";

/**
 * Coverage for a module the P20.3b ablation sweep found had NO exercising test (2026-08-08).
 *
 * Bulk seeding stamps one template over a list and creates a card per entry, so its failure modes are all
 * amplified by the fan-out: a substitution that silently does nothing produces 100 identical cards, and a cap
 * that does not hold produces a board flood. The tests therefore lean on the multiplying cases rather than the
 * single-input happy path.
 */
describe("renderBulkTemplate", () => {
	it("substitutes every token, including repeats of the same token", () => {
		// `replaceAll`, not `replace` — a single-replacement implementation leaves later occurrences as literal
		// `{input}` text in a real prompt, which reads as a templating bug only after the cards exist.
		expect(renderBulkTemplate("{input} then {input}", "audit", 0)).toBe("audit then audit");
		expect(renderBulkTemplate("{i}/{i}", "x", 4)).toBe("5/5");
	});

	it("numbers from ONE, not zero — the index a human reads", () => {
		expect(renderBulkTemplate("card {i}", "x", 0)).toBe("card 1");
		expect(renderBulkTemplate("card {i}", "x", 99)).toBe("card 100");
	});

	it("slugifies for {slug}: lowercased, punctuation collapsed, no leading or trailing dashes", () => {
		expect(renderBulkTemplate("{slug}", "Fix the OAuth bug!", 0)).toBe("fix-the-oauth-bug");
		expect(renderBulkTemplate("{slug}", "  spaced  out  ", 0)).toBe("spaced-out");
		expect(renderBulkTemplate("{slug}", "a//b__c", 0)).toBe("a-b-c");
	});

	it("falls back to a positional slug when the input slugifies to NOTHING", () => {
		// An all-punctuation input yields an empty slug, and an empty slug in a branch name or path is a much
		// worse failure than a boring one. The fallback must be unique per index, or the fan-out collides.
		expect(renderBulkTemplate("{slug}", "!!!", 0)).toBe("input-1");
		expect(renderBulkTemplate("{slug}", "###", 7)).toBe("input-8");
		expect(renderBulkTemplate("{slug}", "", 2)).toBe("input-3");
	});

	it("caps a long slug so it cannot overflow a branch or path name", () => {
		const slug = renderBulkTemplate("{slug}", "x".repeat(200), 0);
		expect(slug.length).toBeLessThanOrEqual(48);
	});

	it("leaves a template with no tokens untouched", () => {
		expect(renderBulkTemplate("static prompt", "anything", 3)).toBe("static prompt");
	});
});

describe("parseBulkInputs", () => {
	it("splits on newlines AND commas, trimming each entry", () => {
		expect(parseBulkInputs("a, b\nc ,  d ")).toEqual(["a", "b", "c", "d"]);
		expect(parseBulkInputs("a\r\nb")).toEqual(["a", "b"]);
	});

	it("drops blank lines and `#` comments, so a commented file list works", () => {
		expect(parseBulkInputs("# header\na\n\n# note\nb\n")).toEqual(["a", "b"]);
	});

	it("DEDUPLICATES — a repeated input must not seed two identical cards", () => {
		// The fan-out amplifier: a duplicated line in a pasted list would otherwise create two cards doing
		// exactly the same work, racing each other on the same files.
		expect(parseBulkInputs("a\nb\na\nb\na")).toEqual(["a", "b"]);
	});

	it("throws at the cap rather than flooding the board", () => {
		// Exactly at the cap is legal; one past it is not. A `>=` here would reject a legitimate full batch, and
		// a missing check turns a paste into an unbounded fan-out.
		const atCap = Array.from({ length: BULK_SEED_MAX_INPUTS }, (_, index) => `input-${index}`).join("\n");
		expect(parseBulkInputs(atCap)).toHaveLength(BULK_SEED_MAX_INPUTS);

		const overCap = Array.from({ length: BULK_SEED_MAX_INPUTS + 1 }, (_, index) => `input-${index}`).join("\n");
		expect(() => parseBulkInputs(overCap)).toThrow(/capped at 100/i);
	});

	it("the cap counts inputs BEFORE deduplication is what the user is warned about", () => {
		// 150 lines that dedupe to 2 still exceeds the cap: the guard is about the size of what was pasted, and
		// reporting the pre-dedup count is what makes the error message actionable ("split the list").
		expect(() => parseBulkInputs(Array.from({ length: 150 }, () => "same").join("\n"))).toThrow(/150 given/);
	});

	it("returns an empty list for empty or comment-only input, rather than throwing", () => {
		expect(parseBulkInputs("")).toEqual([]);
		expect(parseBulkInputs("# only a comment\n\n")).toEqual([]);
	});
});

describe("planBulkSeed", () => {
	it("expands the template across every input, with per-entry indices", () => {
		const plan = planBulkSeed({
			promptTemplate: "Handle {input} (card {i})",
			titleTemplate: "{slug}",
			inputs: ["First Thing", "Second Thing"],
		});
		expect(plan).toEqual([
			{ input: "First Thing", title: "first-thing", prompt: "Handle First Thing (card 1)" },
			{ input: "Second Thing", title: "second-thing", prompt: "Handle Second Thing (card 2)" },
		]);
	});

	it("defaults the title to the raw input when no title template is given", () => {
		const [entry] = planBulkSeed({ promptTemplate: "do {input}", inputs: ["Some Input"] });
		expect(entry?.title).toBe("Some Input");
	});

	it("returns an empty plan for no inputs — nothing to seed is not an error", () => {
		expect(planBulkSeed({ promptTemplate: "x", inputs: [] })).toEqual([]);
	});
});

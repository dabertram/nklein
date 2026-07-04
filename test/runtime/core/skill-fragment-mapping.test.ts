import { describe, expect, it } from "vitest";
import { DRAFT_SKILL_FRAGMENT_MAPPINGS, resolveSkillFragmentMapping } from "../../../src/core/skill-fragment-mapping";
import type { ContextFragmentId } from "../../../src/core/skill-registry";

// The full ContextFragmentId union — kept here so a change to the registry breaks this parity test (forcing the
// draft mapping to be updated) rather than silently leaving a fragment unmapped.
const ALL_FRAGMENT_IDS: ContextFragmentId[] = [
	"temporal",
	"repo_map",
	"focus_chain",
	"refinement_preamble",
	"efficiency_rules",
	"freshness_rail",
	"online_retrieval",
];

describe("DRAFT skill-fragment mapping (decision-10, held for approval)", () => {
	it("covers EVERY ContextFragmentId exactly once (parity)", () => {
		const mapped = DRAFT_SKILL_FRAGMENT_MAPPINGS.map((m) => m.fragmentId).sort();
		expect(mapped).toEqual([...ALL_FRAGMENT_IDS].sort());
		expect(new Set(mapped).size).toBe(ALL_FRAGMENT_IDS.length); // no dupes
	});

	it("canonicalizes to hyphenated lowercase assembler keys (underscore → hyphen; temporal → temporal-context)", () => {
		expect(resolveSkillFragmentMapping("efficiency_rules").assemblerKey).toBe("efficiency-rules");
		expect(resolveSkillFragmentMapping("temporal").assemblerKey).toBe("temporal-context");
		expect(resolveSkillFragmentMapping("online_retrieval").assemblerKey).toBe("online-retrieval");
		for (const m of DRAFT_SKILL_FRAGMENT_MAPPINGS) {
			expect(m.assemblerKey).toMatch(/^[a-z]+(?:-[a-z]+)*$/);
		}
	});

	it("marks repo_map + focus_chain as needing a producer (aspirational — do not inject empty)", () => {
		expect(resolveSkillFragmentMapping("repo_map").producer).toBe("needs_producer");
		expect(resolveSkillFragmentMapping("focus_chain").producer).toBe("needs_producer");
		// The rest are wired (text producers exist, just need routing to the key).
		for (const id of [
			"temporal",
			"efficiency_rules",
			"refinement_preamble",
			"freshness_rail",
			"online_retrieval",
		] as const) {
			expect(resolveSkillFragmentMapping(id).producer).toBe("wired");
		}
	});
});

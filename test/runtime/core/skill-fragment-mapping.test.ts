import { describe, expect, it } from "vitest";
import { resolveSkillFragmentMapping, SKILL_FRAGMENT_MAPPINGS } from "../../../src/core/skill-fragment-mapping";
import type { ContextFragmentId } from "../../../src/core/skill-registry";

// The full ContextFragmentId union — kept here so a change to the registry breaks this parity test (forcing the
// mapping to be updated) rather than silently leaving a fragment unmapped.
const ALL_FRAGMENT_IDS: ContextFragmentId[] = [
	"temporal",
	"repo_map",
	"focus_chain",
	"refinement_preamble",
	"efficiency_rules",
	"freshness_rail",
	"online_retrieval",
	"klein_self_corpus",
];

describe("skill-fragment mapping (decision-10, APPROVED)", () => {
	it("covers EVERY ContextFragmentId exactly once (parity)", () => {
		const mapped = SKILL_FRAGMENT_MAPPINGS.map((m) => m.fragmentId).sort();
		expect(mapped).toEqual([...ALL_FRAGMENT_IDS].sort());
		expect(new Set(mapped).size).toBe(ALL_FRAGMENT_IDS.length); // no dupes
	});

	it("canonicalizes to hyphenated lowercase assembler keys (underscore → hyphen; temporal → temporal-context)", () => {
		expect(resolveSkillFragmentMapping("efficiency_rules").assemblerKey).toBe("efficiency-rules");
		expect(resolveSkillFragmentMapping("temporal").assemblerKey).toBe("temporal-context");
		expect(resolveSkillFragmentMapping("online_retrieval").assemblerKey).toBe("online-retrieval");
		for (const m of SKILL_FRAGMENT_MAPPINGS) {
			expect(m.assemblerKey).toMatch(/^[a-z]+(?:-[a-z]+)*$/);
		}
	});

	it("efficiency_rules + temporal + repo_map are `wired`; the rest need a producer (reconciled against the real seam)", () => {
		// These have a clean, non-duplicating system-prompt producer: efficiency_rules + temporal (already keyed) and
		// repo_map (buildNKleinRepoMap().rendered — the one fragment genuinely absent from the system prompt).
		for (const id of ["efficiency_rules", "temporal", "repo_map"] as const) {
			expect(resolveSkillFragmentMapping(id).producer).toBe("wired");
		}
		// The rest stay needs_producer — focus_chain is a live per-turn message; freshness_rail is embedded in temporal;
		// refinement_preamble routes via a different concat seam (would double); online_retrieval is only a tool desc.
		for (const id of ["focus_chain", "refinement_preamble", "freshness_rail", "online_retrieval"] as const) {
			expect(resolveSkillFragmentMapping(id).producer).toBe("needs_producer");
		}
	});
});

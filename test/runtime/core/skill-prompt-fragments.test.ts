import { describe, expect, it } from "vitest";
import { buildSkillPromptFragments } from "../../../src/core/skill-prompt-fragments";
import type { ContextFragmentId } from "../../../src/core/skill-registry";

const produceAll = (id: ContextFragmentId): string => `TEXT[${id}]`;

describe("buildSkillPromptFragments", () => {
	it("routes only `wired` fragments to their canonical assembler key + volatility", () => {
		const fragments = buildSkillPromptFragments(["efficiency_rules", "temporal"], produceAll);
		expect(fragments).toEqual([
			{ key: "efficiency-rules", volatility: "static", text: "TEXT[efficiency_rules]" },
			{ key: "temporal-context", volatility: "daily", text: "TEXT[temporal]" },
		]);
	});

	it("skips `needs_producer` ids so no empty/aspirational block is injected", () => {
		// repo_map, focus_chain, freshness_rail, refinement_preamble, online_retrieval are all needs_producer.
		const fragments = buildSkillPromptFragments(
			["repo_map", "focus_chain", "freshness_rail", "refinement_preamble", "online_retrieval"],
			produceAll,
		);
		expect(fragments).toEqual([]);
	});

	it("drops a wired fragment whose producer yields empty/whitespace text", () => {
		const fragments = buildSkillPromptFragments(["efficiency_rules", "temporal"], (id) =>
			id === "temporal" ? "   " : "rules",
		);
		expect(fragments).toEqual([{ key: "efficiency-rules", volatility: "static", text: "rules" }]);
	});

	it("dedups by assembler key when the same fragment is declared twice", () => {
		const fragments = buildSkillPromptFragments(["efficiency_rules", "efficiency_rules"], produceAll);
		expect(fragments).toHaveLength(1);
	});

	it("an empty active set yields no fragments (inert)", () => {
		expect(buildSkillPromptFragments([], produceAll)).toEqual([]);
	});
});

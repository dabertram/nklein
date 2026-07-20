import { describe, expect, it } from "vitest";
import {
	COMPACTION_FORMATS,
	type CompactionFact,
	renderAllArms,
	renderCompaction,
} from "../../src/core/compaction-format";

const FACTS: CompactionFact[] = [
	{ id: "f1", text: "The export command writes CSV" },
	{ id: "f2", text: "Rows are streamed, not buffered" },
	{ id: "f3", text: "The header is emitted once" },
	{ id: "f4", text: "Encoding is UTF-8 without a BOM" },
	{ id: "f5", text: "Errors abort the whole file" },
];

describe("renderCompaction", () => {
	it("every arm presents the SAME facts — only arrangement differs", () => {
		// An arm that dropped or added a fact would measure summarisation quality while claiming to measure
		// structure, which is the one confound that would invalidate the whole experiment.
		const arms = renderAllArms(FACTS);
		for (const format of COMPACTION_FORMATS) {
			expect([...arms[format].order].sort()).toEqual(["f1", "f2", "f3", "f4", "f5"]);
		}
	});

	it("shuffles DETERMINISTICALLY — the same seed gives the same permutation", () => {
		// An unseeded shuffle would make every run a different treatment, so a difference between runs could not be
		// attributed to the format rather than to the draw. The comparison would produce numbers and no knowledge.
		const a = renderCompaction({ facts: FACTS, format: "shuffled_facts", shuffleSeed: 42 });
		const b = renderCompaction({ facts: FACTS, format: "shuffled_facts", shuffleSeed: 42 });
		expect(a.order).toEqual(b.order);
	});

	it("different seeds give different permutations", () => {
		const a = renderCompaction({ facts: FACTS, format: "shuffled_facts", shuffleSeed: 1 });
		const b = renderCompaction({ facts: FACTS, format: "shuffled_facts", shuffleSeed: 999 });
		expect(a.order).not.toEqual(b.order);
	});

	it("actually de-coheres — the shuffled arm is not source order", () => {
		// A "shuffle" that returned source order would silently make the Chroma condition a duplicate of fact_list,
		// and the A/B would report no difference for the most boring possible reason.
		const shuffled = renderCompaction({ facts: FACTS, format: "shuffled_facts", shuffleSeed: 7 });
		expect(shuffled.order).not.toEqual(["f1", "f2", "f3", "f4", "f5"]);
	});

	it("preserves source order for fact_list and narrative", () => {
		for (const format of ["fact_list", "narrative"] as const) {
			expect(renderCompaction({ facts: FACTS, format }).order).toEqual(["f1", "f2", "f3", "f4", "f5"]);
		}
	});

	it("renders narrative as prose and lists as bullets", () => {
		expect(renderCompaction({ facts: FACTS, format: "narrative" }).text).not.toContain("- ");
		expect(renderCompaction({ facts: FACTS, format: "fact_list" }).text).toContain("- ");
	});

	it("drops blank facts rather than emitting empty bullets", () => {
		const arms = renderAllArms([...FACTS, { id: "blank", text: "   " }]);
		expect(arms.fact_list.order).not.toContain("blank");
	});

	it("handles an empty fact set without throwing", () => {
		for (const format of COMPACTION_FORMATS) {
			expect(() => renderCompaction({ facts: [], format })).not.toThrow();
		}
	});

	it("handles a single fact — a shuffle of one is still one", () => {
		const one = renderCompaction({ facts: [FACTS[0] as CompactionFact], format: "shuffled_facts" });
		expect(one.order).toEqual(["f1"]);
	});

	it("ships NO default preference between the arms", () => {
		// The whole content of P18.6 is that nobody has measured this. A module that quietly recommended one arm on
		// the strength of a single surprising paper would be doing what the item warns against, with an extra step.
		expect(COMPACTION_FORMATS).toHaveLength(3);
		expect(COMPACTION_FORMATS).toContain("narrative");
		expect(COMPACTION_FORMATS).toContain("shuffled_facts");
	});
});

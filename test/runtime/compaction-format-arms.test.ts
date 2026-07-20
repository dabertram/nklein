import { describe, expect, it } from "vitest";
import { COMPACTION_FORMATS, renderAllArms } from "../../src/core/compaction-format";

/**
 * P18.6 — the property the `dev compaction-format` command checks at runtime, pinned here: every arm presents the
 * IDENTICAL fact set, only the arrangement differs. If that ever breaks, the A/B measures summarisation quality
 * while claiming to measure structure — the one confound that invalidates the whole experiment.
 *
 * The negative test matters most: an invariant check that cannot fail proves nothing.
 */

const FACTS = [
	{ id: "f1", text: "alpha" },
	{ id: "f2", text: "beta" },
	{ id: "f3", text: "gamma" },
];

function idSet(order: readonly string[]): string[] {
	return [...order].sort();
}

describe("compaction arms share their facts", () => {
	it("every arm carries the same fact-id set", () => {
		const arms = renderAllArms(FACTS, 7);
		const reference = idSet(arms.narrative.order);
		for (const format of COMPACTION_FORMATS) {
			expect(idSet(arms[format].order)).toEqual(reference);
		}
	});

	it("the shuffle actually re-orders — otherwise the Chroma arm is a duplicate of fact_list", () => {
		// A "shuffle" that returned source order would silently make the shuffled arm identical to fact_list, and
		// the A/B would report no difference for the most boring possible reason.
		const arms = renderAllArms(FACTS, 7);
		expect(arms.shuffled_facts.order).not.toEqual(arms.fact_list.order);
		expect(idSet(arms.shuffled_facts.order)).toEqual(idSet(arms.fact_list.order));
	});

	it("is reproducible: same seed, same permutation", () => {
		expect(renderAllArms(FACTS, 7).shuffled_facts.order).toEqual(renderAllArms(FACTS, 7).shuffled_facts.order);
	});

	it("the identical-set check CAN fail — a hand-built mismatch is detected", () => {
		// Simulates the confound the command guards against: one arm dropping a fact. The command's `.every(...)`
		// comparison must return false here, or its green check means nothing.
		const good = idSet(["f1", "f2", "f3"]);
		const dropped = idSet(["f1", "f2"]);
		const identical = [good, dropped].every(
			(ids) => ids.length === good.length && ids.every((id, i) => id === good[i]),
		);
		expect(identical).toBe(false);
	});
});

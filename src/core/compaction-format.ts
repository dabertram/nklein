/**
 * P18.6 — the compaction FORMAT, made testable instead of assumed. PURE core.
 *
 * Chroma's context-rot work found something nobody has followed up on: **all 18 models tested performed BETTER on
 * shuffled haystacks than on logically coherent ones.** If coherent structure is a liability for retrieval, then
 * a well-written narrative summary — the standard compaction artefact, and what !Klein produces — is **not
 * self-evidently the right format.**
 *
 * That result is strange enough that the correct response is neither to adopt it nor to dismiss it, but to make
 * the comparison cheap. This module renders the same extracted facts three ways so the eval harness can A/B them:
 *  - `narrative`      — prose summary. Today's default, and the one under suspicion.
 *  - `fact_list`      — bullets, source order preserved.
 *  - `shuffled_facts` — bullets, deliberately de-cohered. The Chroma condition.
 *
 * ── WHY THE SHUFFLE IS SEEDED, AND WHY THAT IS NOT A DETAIL ──
 * An unseeded shuffle would make every run a different treatment, so a difference between two runs could not be
 * attributed to the FORMAT rather than to the draw. The comparison would produce numbers and no knowledge. A
 * seeded shuffle is reproducible, so `shuffled_facts` is one stable condition that can be re-run, and two arms
 * can be compared PAIRED (P20.6: roughly a 5× sample-size saving, and free).
 *
 * `Math.random` is also unavailable in this codebase's pure cores by convention — the determinism requirement and
 * the convention point the same way here, which is a good sign rather than a coincidence.
 *
 * ── WHAT THIS DELIBERATELY DOES NOT DO ──
 * It does not pick a winner, and it ships no default preference. The whole content of P18.6 is that **nobody has
 * measured this**, so a module that quietly recommended `fact_list` on the strength of one surprising paper would
 * be doing the thing the item warns against — with an extra step. The formats are equals here until the harness
 * says otherwise, and P18.5's provenance rules apply to whatever it says.
 */

export type CompactionFormat = "narrative" | "fact_list" | "shuffled_facts";

export const COMPACTION_FORMATS: readonly CompactionFormat[] = ["narrative", "fact_list", "shuffled_facts"];

export interface CompactionFact {
	/** Stable id so an A/B can trace which facts survived into an answer. */
	readonly id: string;
	readonly text: string;
}

/**
 * Deterministic 32-bit hash → the shuffle's randomness source. Small, dependency-free and reproducible; the point
 * is repeatability, not statistical quality.
 */
function seededOrder(count: number, seed: number): number[] {
	const indices = Array.from({ length: count }, (_, index) => index);
	let state = (seed | 0) === 0 ? 0x9e3779b9 : seed | 0;
	// Fisher–Yates driven by xorshift32 — same seed, same permutation, on every machine and every run.
	for (let index = count - 1; index > 0; index -= 1) {
		state ^= state << 13;
		state ^= state >>> 17;
		state ^= state << 5;
		const pick = Math.abs(state) % (index + 1);
		const swap = indices[index] as number;
		indices[index] = indices[pick] as number;
		indices[pick] = swap;
	}
	return indices;
}

export interface RenderedCompaction {
	readonly format: CompactionFormat;
	readonly text: string;
	/** Fact ids in the order they appear — the record of what this arm actually presented. */
	readonly order: readonly string[];
}

/**
 * Render extracted facts in one format.
 *
 * Every arm presents the SAME facts; only arrangement and prose differ. That is what makes the comparison about
 * format rather than about content — an arm that dropped or added a fact would be measuring summarisation
 * quality while claiming to measure structure.
 */
export function renderCompaction(input: {
	readonly facts: readonly CompactionFact[];
	readonly format: CompactionFormat;
	readonly shuffleSeed?: number;
}): RenderedCompaction {
	const facts = input.facts.filter((fact) => fact.text.trim().length > 0);

	if (input.format === "shuffled_facts") {
		const order = seededOrder(facts.length, input.shuffleSeed ?? 1);
		const shuffled = order.map((index) => facts[index] as CompactionFact);
		return {
			format: "shuffled_facts",
			text: shuffled.map((fact) => `- ${fact.text}`).join("\n"),
			order: shuffled.map((fact) => fact.id),
		};
	}

	if (input.format === "fact_list") {
		return {
			format: "fact_list",
			text: facts.map((fact) => `- ${fact.text}`).join("\n"),
			order: facts.map((fact) => fact.id),
		};
	}

	// Narrative: joined prose in source order. Deliberately plain — an elaborately-written arm would confound
	// "coherent structure" with "better writing", and the hypothesis under test is about the former.
	return {
		format: "narrative",
		text: facts.map((fact) => fact.text.trim().replace(/\.?$/, ".")).join(" "),
		order: facts.map((fact) => fact.id),
	};
}

/**
 * Render every arm from one fact set, ready for a paired comparison.
 *
 * Paired on the identical facts by construction — P20.6 notes that paired question-level differencing is worth
 * roughly a 5× sample-size saving and is free, and it is only free if the arms genuinely share their inputs.
 */
export function renderAllArms(
	facts: readonly CompactionFact[],
	shuffleSeed = 1,
): Record<CompactionFormat, RenderedCompaction> {
	return {
		narrative: renderCompaction({ facts, format: "narrative" }),
		fact_list: renderCompaction({ facts, format: "fact_list" }),
		shuffled_facts: renderCompaction({ facts, format: "shuffled_facts", shuffleSeed }),
	};
}

import { describe, expect, it } from "vitest";
import {
	compareRetrievalModes,
	evaluateRetrievalMode,
	type LabeledRetrievalQuery,
	precisionAtK,
	type RetrievalRanker,
	recallAtK,
	reciprocalRank,
} from "../../../src/core/retrieval-recall-eval";
import { lexicalRelevanceScore, tokenizeQuery } from "../../../src/core/retrieval-rerank";

describe("recallAtK", () => {
	it("computes |relevant ∩ top-k| / |relevant|", () => {
		expect(recallAtK(["a", "b", "c", "d"], ["a", "c"], 2)).toBe(0.5); // only "a" in top-2
		expect(recallAtK(["a", "b", "c", "d"], ["a", "c"], 3)).toBe(1); // both in top-3
		expect(recallAtK(["x", "y"], ["a"], 2)).toBe(0);
	});

	it("guards empty ground truth and non-positive k", () => {
		expect(recallAtK(["a"], [], 5)).toBe(0);
		expect(recallAtK(["a"], ["a"], 0)).toBe(0);
	});
});

// ── A small labeled code-retrieval fixture measured with the REAL lexical scorer ─────────────────────────────
const CORPUS: ReadonlyArray<{ id: string; text: string }> = [
	{ id: "board", text: "kanban board column card lane move task drag drop" },
	{ id: "merge", text: "git merge result branch dependency order conflict resolution" },
	{ id: "retry", text: "adaptive retry ladder budget stall truncation recovery model" },
	{ id: "memory", text: "chat memory recall embedding summary consolidation long term" },
	{ id: "docker", text: "docker sandbox container isolation network none mount readonly" },
	{ id: "prompt", text: "system prompt fragment assembly cache prefix stability tokens" },
];

const LABELED: LabeledRetrievalQuery[] = [
	{ query: "retry budget on a stalled model", relevantIds: ["retry"] },
	{ query: "merge dependency ordering conflicts", relevantIds: ["merge"] },
	{ query: "container isolation and readonly mounts", relevantIds: ["docker"] },
	{ query: "long term memory recall", relevantIds: ["memory"] },
];

/** Lexical mode: rank the corpus by the real lexical relevance scorer. */
const lexicalRanker: RetrievalRanker = (query) => {
	const terms = tokenizeQuery(query);
	return [...CORPUS]
		.map((doc) => ({ id: doc.id, score: lexicalRelevanceScore(terms, doc.text) }))
		.sort((left, right) => right.score - left.score)
		.map((doc) => doc.id);
};

/** A deliberately-poor mode (reverse corpus order, query-blind) to prove the comparison discriminates. */
const randomishRanker: RetrievalRanker = () => [...CORPUS].map((doc) => doc.id).reverse();

describe("evaluateRetrievalMode + compareRetrievalModes (the §5.I recall@k measurement)", () => {
	it("measures the real lexical scorer at recall@1 = 1.0 on the labeled fixture", () => {
		const report = evaluateRetrievalMode("lexical", lexicalRanker, LABELED, [1, 3]);
		expect(report.recallAtK).toMatchObject([
			{ k: 1, recall: 1 },
			{ k: 3, recall: 1 },
		]);
		// recall@1 = 1 means the top-1 hit is always relevant => precision@1 is also 1.
		expect(report.recallAtK[0]?.precision).toBe(1);
	});

	it("ranks lexical above a query-blind baseline and reports the winner per k", () => {
		const comparison = compareRetrievalModes(
			[
				{ mode: "lexical", ranker: lexicalRanker },
				{ mode: "baseline", ranker: randomishRanker },
			],
			LABELED,
			[1, 3],
		);
		expect(comparison.queryCount).toBe(4);
		expect(comparison.bestModeByK[1]).toBe("lexical");
		expect(comparison.bestModeByK[3]).toBe("lexical");
		const baseline = comparison.modes.find((m) => m.mode === "baseline");
		expect(baseline?.recallAtK.find((p) => p.k === 1)?.recall).toBeLessThan(1);
	});

	it("resolves an equal-recall tie to the EARLIER (cheaper) mode — dense must BEAT lexical to pay its way", () => {
		const comparison = compareRetrievalModes(
			[
				{ mode: "lexical", ranker: lexicalRanker },
				{ mode: "dense-equal", ranker: lexicalRanker }, // identical ranking ⇒ identical recall
			],
			LABELED,
			[1],
		);
		expect(comparison.bestModeByK[1]).toBe("lexical");
	});
});

describe("precision@k + MRR (the rest of the qrels triple — diagnostic-oracles slice)", () => {
	it("precisionAtK = |relevant ∩ top-k| / k, independent of ground-truth size", () => {
		expect(precisionAtK(["a", "b", "c", "d"], ["a", "c"], 2)).toBeCloseTo(0.5);
		expect(precisionAtK(["a", "b", "c", "d"], ["a", "c"], 4)).toBeCloseTo(0.5);
		expect(precisionAtK(["x", "y"], ["a"], 2)).toBe(0);
		expect(precisionAtK(["a"], [], 1)).toBe(0);
	});

	it("reciprocalRank = 1/rank of the FIRST relevant hit, 0 when none ranked", () => {
		expect(reciprocalRank(["x", "a", "y"], ["a"])).toBeCloseTo(1 / 2);
		expect(reciprocalRank(["a", "x"], ["a", "x"])).toBe(1);
		expect(reciprocalRank(["x", "y"], ["a"])).toBe(0);
	});

	it("evaluateRetrievalMode reports macro-averaged precision alongside recall, and MRR per mode", () => {
		const report = evaluateRetrievalMode("lexical", lexicalRanker, LABELED, [1, 3]);
		for (const point of report.recallAtK) {
			expect(point.precision).toBeGreaterThanOrEqual(0);
			expect(point.precision).toBeLessThanOrEqual(1);
		}
		expect(report.mrr).toBeGreaterThan(0);
		expect(report.mrr).toBeLessThanOrEqual(1);
	});
});

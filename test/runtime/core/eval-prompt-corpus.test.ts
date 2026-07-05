import { describe, expect, it } from "vitest";
import {
	EVAL_CORPUS_VERSION,
	EVAL_PROMPT_CORPUS,
	type EvalPrompt,
	evalCorpusFingerprint,
	evalPromptById,
	evalPromptSchema,
	evalPromptsByDifficulty,
	evalPromptsByRole,
	scoreEvalAnswer,
} from "../../../src/core/eval-prompt-corpus";
import { scoreValidDag } from "../../../src/core/prompt-family-scorers";

describe("eval-prompt-corpus", () => {
	it("every row validates against the schema (round-trip)", () => {
		for (const prompt of EVAL_PROMPT_CORPUS) {
			expect(() => evalPromptSchema.parse(prompt)).not.toThrow();
		}
	});

	it("row ids are unique + kebab (they key the harness result set)", () => {
		const ids = EVAL_PROMPT_CORPUS.map((p) => p.id);
		expect(new Set(ids).size).toBe(ids.length);
		for (const id of ids) {
			expect(id).toMatch(/^[a-z0-9-]+$/);
		}
	});

	it("family and role are consistent per row", () => {
		const expected: Record<EvalPrompt["family"], EvalPrompt["role"]> = {
			decompose: "architect",
			implement: "worker",
			review: "reviewer",
		};
		for (const prompt of EVAL_PROMPT_CORPUS) {
			expect(prompt.role).toBe(expected[prompt.family]);
		}
	});

	it("covers all three roles and all three difficulty tiers", () => {
		expect(new Set(EVAL_PROMPT_CORPUS.map((p) => p.role))).toEqual(new Set(["architect", "worker", "reviewer"]));
		expect(new Set(EVAL_PROMPT_CORPUS.map((p) => p.difficulty))).toEqual(new Set(["easy", "medium", "hard"]));
	});

	it("every decompose reference is a VALID dag (the answer key self-scores 1)", () => {
		for (const prompt of EVAL_PROMPT_CORPUS) {
			if (prompt.family === "decompose") {
				expect(scoreValidDag(prompt.reference)).toBe(1);
				// and via the dispatcher
				expect(scoreEvalAnswer(prompt, { family: "decompose", graph: prompt.reference })).toBe(1);
			}
		}
	});

	it("implement rows carry ≥1 acceptance test", () => {
		for (const prompt of EVAL_PROMPT_CORPUS) {
			if (prompt.family === "implement") {
				expect(prompt.tests.length).toBeGreaterThan(0);
			}
		}
	});

	it("review rows seed ≥1 defect with kebab ids", () => {
		for (const prompt of EVAL_PROMPT_CORPUS) {
			if (prompt.family === "review") {
				expect(prompt.seededDefects.length).toBeGreaterThan(0);
				for (const defect of prompt.seededDefects) {
					expect(defect).toMatch(/^[a-z0-9-]+$/);
				}
			}
		}
	});
});

describe("scoreEvalAnswer", () => {
	const decompose = evalPromptById("decompose-cli-version-flag");
	const implement = evalPromptById("implement-slugify");
	const review = evalPromptById("review-race-leak-injection");

	it("decompose: a cyclic answer scores 0", () => {
		if (decompose?.family !== "decompose") throw new Error("fixture missing");
		const cyclic = {
			nodes: ["a", "b"],
			edges: [
				{ from: "a", to: "b" },
				{ from: "b", to: "a" },
			],
		};
		expect(scoreEvalAnswer(decompose, { family: "decompose", graph: cyclic })).toBe(0);
	});

	it("implement: score is the test pass fraction", () => {
		if (implement?.family !== "implement") throw new Error("fixture missing");
		const total = implement.tests.length;
		expect(scoreEvalAnswer(implement, { family: "implement", passed: total, total })).toBe(1);
		expect(scoreEvalAnswer(implement, { family: "implement", passed: 0, total })).toBe(0);
		expect(scoreEvalAnswer(implement, { family: "implement", passed: 2, total: 4 })).toBe(0.5);
	});

	it("review: score is the seeded-defect recall", () => {
		if (review?.family !== "review") throw new Error("fixture missing");
		const seeded = [...review.seededDefects];
		expect(scoreEvalAnswer(review, { family: "review", caught: seeded })).toBe(1);
		expect(scoreEvalAnswer(review, { family: "review", caught: [] })).toBe(0);
		// catching one of three seeded defects → 1/3, and unrelated findings don't count
		expect(scoreEvalAnswer(review, { family: "review", caught: [seeded[0], "some-other-thing"] })).toBeCloseTo(1 / 3);
	});

	it("throws when the answer family mismatches the prompt family", () => {
		if (!decompose) throw new Error("fixture missing");
		expect(() => scoreEvalAnswer(decompose, { family: "review", caught: [] })).toThrow(/does not match/);
	});
});

describe("eval-prompt-corpus selectors", () => {
	it("evalPromptsByRole returns only that role's rows", () => {
		const architects = evalPromptsByRole("architect");
		expect(architects.length).toBeGreaterThan(0);
		expect(architects.every((p) => p.role === "architect")).toBe(true);
	});

	it("evalPromptsByDifficulty filters by tier", () => {
		const hard = evalPromptsByDifficulty("hard");
		expect(hard.length).toBeGreaterThan(0);
		expect(hard.every((p) => p.difficulty === "hard")).toBe(true);
	});

	it("evalPromptById round-trips and returns undefined for an unknown id", () => {
		expect(evalPromptById("implement-slugify")?.id).toBe("implement-slugify");
		expect(evalPromptById("nope")).toBeUndefined();
	});
});

describe("eval-corpus versioning", () => {
	it("EVAL_CORPUS_VERSION is a positive integer", () => {
		expect(Number.isInteger(EVAL_CORPUS_VERSION)).toBe(true);
		expect(EVAL_CORPUS_VERSION).toBeGreaterThan(0);
	});

	it("fingerprint is stable + well-formed (same corpus → same value)", () => {
		const fp = evalCorpusFingerprint();
		expect(fp).toBe(evalCorpusFingerprint(EVAL_PROMPT_CORPUS));
		expect(fp).toMatch(new RegExp(`^v${EVAL_CORPUS_VERSION}-[0-9a-f]{8}$`));
	});

	it("fingerprint changes when any row changes (a change-detector)", () => {
		const base = evalCorpusFingerprint();
		const extraRow = evalCorpusFingerprint([...EVAL_PROMPT_CORPUS, EVAL_PROMPT_CORPUS[0]]);
		expect(extraRow).not.toBe(base);
		const mutated: EvalPrompt[] = [
			{ ...EVAL_PROMPT_CORPUS[0], prompt: "changed prompt text" },
			...EVAL_PROMPT_CORPUS.slice(1),
		];
		expect(evalCorpusFingerprint(mutated)).not.toBe(base);
	});

	it("fingerprint is order-sensitive but total over the empty corpus", () => {
		expect(evalCorpusFingerprint([])).toMatch(/^v\d+-[0-9a-f]{8}$/);
	});
});

import { describe, expect, it } from "vitest";
import {
	buildContextProbeInput,
	EVAL_CORPUS_VERSION,
	EVAL_PROMPT_CORPUS,
	type EvalPrompt,
	evalCorpusFingerprint,
	evalPromptById,
	evalPromptSchema,
	evalPromptsByDifficulty,
	evalPromptsByRole,
	scoreContextProbeAnswer,
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
			tool_use: "worker",
			context_probe: "worker",
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

	it("context probes: deterministic haystack, needle buried at depth, size scales with contextTokens (§5.AD)", () => {
		const probes = EVAL_PROMPT_CORPUS.filter((prompt) => prompt.family === "context_probe");
		expect(probes.length).toBeGreaterThanOrEqual(3);
		let previousLength = 0;
		for (const probe of [...probes].sort((a, b) => a.contextTokens - b.contextTokens)) {
			const input = buildContextProbeInput(probe);
			// Deterministic: repeats measure the model, never the probe.
			expect(buildContextProbeInput(probe)).toBe(input);
			// The needle is present exactly once, never at the very start or end (the question closes the input).
			expect(input.split(probe.needle).length - 1).toBe(1);
			expect(input.startsWith(probe.needle)).toBe(false);
			expect(input.trimEnd().endsWith("log above.")).toBe(true);
			// Bigger contextTokens ⇒ strictly bigger haystack (roughly ~4 chars/token).
			expect(input.length).toBeGreaterThan(previousLength);
			previousLength = input.length;
			expect(input.length).toBeGreaterThan(probe.contextTokens * 2);
			// Self-test: the needle text itself scores 1 against the probe's own answer key.
			expect(scoreEvalAnswer(probe, { family: "context_probe", answerText: probe.needle })).toBe(1);
		}
	});

	it("context-probe scorer: fragment match is case-insensitive, misses score 0", () => {
		expect(scoreContextProbeAnswer("The site is in PORTO.", ["porto"])).toBe(1);
		expect(scoreContextProbeAnswer("No idea, the log is noise.", ["porto"])).toBe(0);
	});

	it("context-probe scorer: SEPARATOR-insensitive — a correct retrieval scores on content, not typography (§11 harness fix)", () => {
		// The real 2026-07-11 mis-score: nemotron-nano + gpt-oss answered the needle with NON-BREAKING hyphens
		// (U+2011), a CORRECT answer that the old exact-substring match scored 0. Now dashes/spaces/underscores all match.
		expect(scoreContextProbeAnswer("The passphrase is amber‑falcon‑92.", ["amber-falcon-92"])).toBe(1); // non-breaking hyphen
		expect(scoreContextProbeAnswer("it was amber falcon 92", ["amber-falcon-92"])).toBe(1); // spaces
		expect(scoreContextProbeAnswer("amber_falcon_92", ["amber-falcon-92"])).toBe(1); // underscores
		expect(scoreContextProbeAnswer("en–dash amber–falcon–92", ["amber-falcon-92"])).toBe(1); // en dash
		// Plain-token fragments are unaffected, and a genuinely wrong compound still scores 0 (no false positives).
		expect(scoreContextProbeAnswer("badge 7431", ["7431"])).toBe(1);
		expect(scoreContextProbeAnswer("the value was blue-heron-11", ["amber-falcon-92"])).toBe(0);
	});

	it("every tool_use probe self-scores 1 (its expected call IS the answer key)", () => {
		let toolUseCount = 0;
		for (const prompt of EVAL_PROMPT_CORPUS) {
			if (prompt.family === "tool_use") {
				toolUseCount += 1;
				const called = prompt.expected ? { name: prompt.expected.name, args: prompt.expected.args } : null;
				expect(scoreEvalAnswer(prompt, { family: "tool_use", called })).toBe(1);
			}
		}
		// simple + multi-select + irrelevance
		expect(toolUseCount).toBeGreaterThanOrEqual(3);
	});
});

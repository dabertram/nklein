import { describe, expect, it } from "vitest";
import { assessRetrievalSufficiency } from "../../../src/core/retrieval-sufficiency";

describe("assessRetrievalSufficiency", () => {
	it("returns sufficient with empty reasons when all conditions are met", () => {
		const verdict = assessRetrievalSufficiency({
			subQuestions: ["What is X?", "How does Y work?"],
			coveredSubQuestions: ["What is X?", "How does Y work?"],
			sourceCount: 3,
			minSources: 2,
			freshnessSatisfied: true,
		});
		expect(verdict.sufficient).toBe(true);
		expect(verdict.unmetSubQuestions).toEqual([]);
		expect(verdict.reasons).toEqual([]);
	});

	it("is not sufficient and lists the uncovered sub-question when one is missing", () => {
		const verdict = assessRetrievalSufficiency({
			subQuestions: ["What is X?", "How does Y work?"],
			coveredSubQuestions: ["What is X?"],
			sourceCount: 3,
			minSources: 2,
			freshnessSatisfied: true,
		});
		expect(verdict.sufficient).toBe(false);
		expect(verdict.unmetSubQuestions).toEqual(["How does Y work?"]);
		expect(verdict.reasons).toHaveLength(1);
		expect(verdict.reasons[0]).toMatch(/1 sub-question\(s\) still uncovered/);
	});

	it("is not sufficient and includes a source-count reason when sourceCount < minSources", () => {
		const verdict = assessRetrievalSufficiency({
			subQuestions: ["What is X?"],
			coveredSubQuestions: ["What is X?"],
			sourceCount: 1,
			minSources: 2,
			freshnessSatisfied: true,
		});
		expect(verdict.sufficient).toBe(false);
		expect(verdict.unmetSubQuestions).toEqual([]);
		expect(verdict.reasons).toHaveLength(1);
		expect(verdict.reasons[0]).toMatch(/only 1 source\(s\), need 2/);
	});

	it("is not sufficient and includes a freshness reason when freshnessSatisfied is false", () => {
		const verdict = assessRetrievalSufficiency({
			subQuestions: ["What is X?"],
			coveredSubQuestions: ["What is X?"],
			sourceCount: 5,
			minSources: 2,
			freshnessSatisfied: false,
		});
		expect(verdict.sufficient).toBe(false);
		expect(verdict.unmetSubQuestions).toEqual([]);
		expect(verdict.reasons).toHaveLength(1);
		expect(verdict.reasons[0]).toBe("freshness not satisfied");
	});

	it("matches coverage case-insensitively and with varied whitespace", () => {
		const verdict = assessRetrievalSufficiency({
			subQuestions: ["  What IS  X?  "],
			coveredSubQuestions: ["what is x?"],
			sourceCount: 2,
			minSources: 1,
			freshnessSatisfied: true,
		});
		expect(verdict.sufficient).toBe(true);
		expect(verdict.unmetSubQuestions).toEqual([]);
		expect(verdict.reasons).toEqual([]);
	});

	it("deduplicates sub-questions by normalised form, keeping the first original", () => {
		const verdict = assessRetrievalSufficiency({
			subQuestions: ["What is X?", "WHAT IS X?", "what is x?"],
			coveredSubQuestions: ["what is x?"],
			sourceCount: 2,
			minSources: 1,
			freshnessSatisfied: true,
		});
		// Only one distinct question after dedup, and it is covered — so sufficient.
		expect(verdict.sufficient).toBe(true);
		expect(verdict.unmetSubQuestions).toEqual([]);
	});

	it("is sufficient when subQuestions is empty and all other conditions hold", () => {
		const verdict = assessRetrievalSufficiency({
			subQuestions: [],
			coveredSubQuestions: [],
			sourceCount: 2,
			minSources: 2,
			freshnessSatisfied: true,
		});
		expect(verdict.sufficient).toBe(true);
		expect(verdict.unmetSubQuestions).toEqual([]);
		expect(verdict.reasons).toEqual([]);
	});

	it("reports all three reasons at once when all three conditions fail", () => {
		const verdict = assessRetrievalSufficiency({
			subQuestions: ["Q1", "Q2"],
			coveredSubQuestions: [],
			sourceCount: 0,
			minSources: 3,
			freshnessSatisfied: false,
		});
		expect(verdict.sufficient).toBe(false);
		expect(verdict.unmetSubQuestions).toEqual(["Q1", "Q2"]);
		expect(verdict.reasons).toHaveLength(3);
		expect(verdict.reasons[0]).toMatch(/sub-question/);
		expect(verdict.reasons[1]).toMatch(/source/);
		expect(verdict.reasons[2]).toMatch(/freshness/);
	});

	it("ignores extra entries in coveredSubQuestions that have no matching subQuestion (superset is harmless)", () => {
		const verdict = assessRetrievalSufficiency({
			subQuestions: ["What is X?"],
			coveredSubQuestions: ["What is X?", "Completely unrelated question", "Another extra"],
			sourceCount: 2,
			minSources: 1,
			freshnessSatisfied: true,
		});
		expect(verdict.sufficient).toBe(true);
		expect(verdict.unmetSubQuestions).toEqual([]);
		expect(verdict.reasons).toEqual([]);
	});

	it("preserves the original casing of unmet sub-questions", () => {
		const verdict = assessRetrievalSufficiency({
			subQuestions: ["HOW Does Y Work?"],
			coveredSubQuestions: [],
			sourceCount: 2,
			minSources: 1,
			freshnessSatisfied: true,
		});
		expect(verdict.sufficient).toBe(false);
		expect(verdict.unmetSubQuestions).toEqual(["HOW Does Y Work?"]);
	});

	it("does not mutate the input arrays", () => {
		const subQuestions = ["What is X?", "How does Y work?"];
		const coveredSubQuestions = ["What is X?"];
		const input = {
			subQuestions,
			coveredSubQuestions,
			sourceCount: 3,
			minSources: 2,
			freshnessSatisfied: true,
		};
		assessRetrievalSufficiency(input);
		expect(subQuestions).toEqual(["What is X?", "How does Y work?"]);
		expect(coveredSubQuestions).toEqual(["What is X?"]);
	});
});

describe("minSources no-floor semantics", () => {
	it("minSources <= 0 means no source floor (passes regardless of count); positive still gates", async () => {
		const { assessRetrievalSufficiency } = await import("../../../src/core/retrieval-sufficiency");
		const base = { subQuestions: [], coveredSubQuestions: [], freshnessSatisfied: true };
		expect(assessRetrievalSufficiency({ ...base, sourceCount: 0, minSources: 0 }).sufficient).toBe(true);
		expect(assessRetrievalSufficiency({ ...base, sourceCount: 0, minSources: -3 }).sufficient).toBe(true);
		const gated = assessRetrievalSufficiency({ ...base, sourceCount: 0, minSources: 2 });
		expect(gated.sufficient).toBe(false);
		expect(gated.reasons.some((r) => r.includes("source"))).toBe(true);
	});
});

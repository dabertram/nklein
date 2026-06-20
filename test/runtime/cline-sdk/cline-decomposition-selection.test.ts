import { describe, expect, it } from "vitest";
import {
	generateBestOfNPlanTaskGraph,
	selectBestClinePlanTaskGraph,
} from "../../../src/cline-sdk/cline-decomposition-selection";
import type { ClinePlanTask, ClinePlanTaskGraph } from "../../../src/cline-sdk/cline-plan-artifacts";

function task(partial: Partial<ClinePlanTask> & Pick<ClinePlanTask, "id" | "title">): ClinePlanTask {
	return {
		prompt: partial.prompt ?? partial.title,
		dependsOn: partial.dependsOn ?? [],
		complexity: partial.complexity ?? 40,
		suggestedRole: partial.suggestedRole ?? null,
		filesLikelyTouched: partial.filesLikelyTouched ?? [],
		acceptanceCommand: partial.acceptanceCommand ?? "npm test",
		testFirst: partial.testFirst ?? false,
		acceptanceTestPrompt: partial.acceptanceTestPrompt ?? null,
		knowledgeDebt: partial.knowledgeDebt ?? null,
		...partial,
	};
}

function graph(tasks: ClinePlanTask[]): ClinePlanTaskGraph {
	return { schemaVersion: 1, slug: "demo", title: "Demo", tasks };
}

const COHERENT = graph([
	task({ id: "impl", title: "Implement core" }),
	task({ id: "tests", title: "Add tests", dependsOn: ["impl"] }),
]);

const INCOHERENT = graph([
	task({ id: "impl", title: "Implement core" }),
	task({ id: "tests", title: "Add tests" }), // test card with no dependency on impl → violation
]);

const SIZING_FAIL = graph([task({ id: "huge", title: "Do everything", complexity: 99 })]);

describe("selectBestClinePlanTaskGraph", () => {
	it("prefers the coherent graph over one with violations", () => {
		const result = selectBestClinePlanTaskGraph([INCOHERENT, COHERENT]);
		expect(result.bestIndex).toBe(1);
		expect(result.best).toBe(COHERENT);
		expect(result.scores[1].violations).toBe(0);
		expect(result.scores[0].violations).toBeGreaterThan(0);
	});

	it("disqualifies a candidate that fails sizing validation", () => {
		const result = selectBestClinePlanTaskGraph([SIZING_FAIL, COHERENT]);
		expect(result.scores[0].parseable).toBe(false);
		expect(result.scores[0].error).toBeTruthy();
		expect(result.bestIndex).toBe(1);
	});

	it("returns no best when every candidate is invalid", () => {
		const result = selectBestClinePlanTaskGraph([SIZING_FAIL]);
		expect(result.bestIndex).toBeNull();
		expect(result.best).toBeNull();
	});
});

describe("generateBestOfNPlanTaskGraph", () => {
	it("samples N candidates and selects the best", async () => {
		const candidates = [INCOHERENT, COHERENT, INCOHERENT];
		const result = await generateBestOfNPlanTaskGraph({
			n: 3,
			generate: async (attempt) => candidates[attempt],
		});
		expect(result.attempts).toBe(3);
		expect(result.best).toBe(COHERENT);
	});

	it("tolerates generation attempts that throw", async () => {
		const result = await generateBestOfNPlanTaskGraph({
			n: 3,
			generate: async (attempt) => {
				if (attempt === 0) {
					throw new Error("model error");
				}
				return COHERENT;
			},
		});
		expect(result.attempts).toBe(2);
		expect(result.best).toBe(COHERENT);
	});
});

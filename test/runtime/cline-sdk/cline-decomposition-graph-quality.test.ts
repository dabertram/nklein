import { describe, expect, it } from "vitest";
import { assessClinePlanTaskGraphQuality } from "../../../src/cline-sdk/cline-decomposition-graph-quality";
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

describe("assessClinePlanTaskGraphQuality", () => {
	it("flags a test card that does not depend on any implementation card", () => {
		const result = assessClinePlanTaskGraphQuality(
			graph([
				task({ id: "impl", title: "Implement bass synthesis" }),
				task({ id: "tests", title: "Add sequence rendering tests" }),
			]),
		);
		expect(result.violations).toHaveLength(1);
		expect(result.violations[0]).toContain("tests");
		expect(result.violations[0]).toContain("implementation card");
	});

	it("accepts a test card wired to the implementation it verifies", () => {
		const result = assessClinePlanTaskGraphQuality(
			graph([
				task({ id: "impl", title: "Implement bass synthesis" }),
				task({ id: "tests", title: "Add sequence rendering tests", dependsOn: ["impl"] }),
			]),
		);
		expect(result.violations).toHaveLength(0);
	});

	it("flags a documentation card with no dependency on delivered work", () => {
		const result = assessClinePlanTaskGraphQuality(
			graph([
				task({ id: "impl", title: "Implement kick synthesis" }),
				task({ id: "docs", title: "Update README usage notes" }),
			]),
		);
		expect(result.violations.some((violation) => violation.includes("docs"))).toBe(true);
	});

	it("warns (does not reject) on a likely reversed edge from impl to test", () => {
		const result = assessClinePlanTaskGraphQuality(
			graph([
				task({ id: "core", title: "Implement core" }),
				task({ id: "tests", title: "Audio quality tests", dependsOn: ["core"] }),
				task({ id: "extras", title: "Implement extras", dependsOn: ["tests"] }),
			]),
		);
		expect(result.violations).toHaveLength(0);
		expect(result.warnings.some((warning) => warning.includes("likely reversed"))).toBe(true);
	});

	it("warns on a sparse graph and isolated cards once large enough", () => {
		const result = assessClinePlanTaskGraphQuality(
			graph([
				task({ id: "a", title: "Implement A" }),
				task({ id: "b", title: "Implement B" }),
				task({ id: "c", title: "Implement C" }),
				task({ id: "d", title: "Implement D" }),
				task({ id: "e", title: "Implement E" }),
			]),
		);
		expect(result.dependencyDensity).toBe(0);
		expect(result.isolatedTaskIds).toHaveLength(5);
		expect(result.warnings.some((warning) => warning.includes("sparse"))).toBe(true);
		expect(result.warnings.some((warning) => warning.includes("no dependency edges"))).toBe(true);
	});

	it("does not warn about sparsity for small graphs", () => {
		const result = assessClinePlanTaskGraphQuality(
			graph([task({ id: "a", title: "Implement A" }), task({ id: "b", title: "Implement B" })]),
		);
		expect(result.warnings.some((warning) => warning.includes("sparse"))).toBe(false);
	});

	it("warns when a UI card ignores all domain/control cards", () => {
		const result = assessClinePlanTaskGraphQuality(
			graph([
				task({ id: "domain", title: "Define domain control metadata" }),
				task({ id: "ui", title: "Build the user interface screen", dependsOn: [] }),
			]),
		);
		expect(result.warnings.some((warning) => warning.includes("UI card"))).toBe(true);
	});
});

import { describe, expect, it } from "vitest";
import { assessNKleinPlanTaskGraphQuality } from "../../../src/nklein-agent/nklein-decomposition-graph-quality";
import type { NKleinPlanTask, NKleinPlanTaskGraph } from "../../../src/nklein-agent/nklein-plan-artifacts";

function task(partial: Partial<NKleinPlanTask> & Pick<NKleinPlanTask, "id" | "title">): NKleinPlanTask {
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

function graph(tasks: NKleinPlanTask[]): NKleinPlanTaskGraph {
	return { schemaVersion: 1, slug: "demo", title: "Demo", tasks };
}

describe("assessNKleinPlanTaskGraphQuality", () => {
	it("flags a test card that does not depend on any implementation card", () => {
		const result = assessNKleinPlanTaskGraphQuality(
			graph([
				task({ id: "impl", title: "Implement bass synthesis" }),
				task({ id: "tests", title: "Add sequence rendering tests" }),
			]),
		);
		expect(result.violations).toHaveLength(1);
		expect(result.violations[0]).toContain("tests");
		expect(result.violations[0]).toContain("implementation card");
	});

	it("does not classify an implementation card as a test card when its prompt mentions tests", () => {
		// Regression: the DAW-foundation decompose run looped forever because "Implement TempoMap class … ensure
		// compatibility with timebase.test.js" (touching src/timebase.ts) was flagged as a test card that had to
		// depend on an implementation card — an impossible-to-satisfy violation. Classification keys off the title +
		// touched files, not the prompt body, so the implementation card stays an implementation card.
		const result = assessNKleinPlanTaskGraphQuality(
			graph([
				task({
					id: "timebase-impl",
					title: "Implement TempoMap class with PPQ-based timing",
					prompt:
						"Complete the TempoMap class in timebase.ts with accurate tempo interpolation. Ensure compatibility with existing test cases in timebase.test.js.",
					filesLikelyTouched: ["src/timebase.ts"],
				}),
				task({
					id: "timebase-tests",
					title: "Expand golden tests for tempo mapping edge cases",
					dependsOn: ["timebase-impl"],
					filesLikelyTouched: ["src/timebase.test.js"],
				}),
			]),
		);
		expect(result.violations).toHaveLength(0);
		expect(result.violations.join("\n")).not.toContain("timebase-impl");
	});

	it("treats a card that only touches test files as a test card even with a neutral title", () => {
		const result = assessNKleinPlanTaskGraphQuality(
			graph([
				task({ id: "impl", title: "Implement bass synthesis", filesLikelyTouched: ["src/bass.ts"] }),
				task({
					id: "cover",
					title: "Cover edge cases for the bass voice",
					filesLikelyTouched: ["src/bass.test.ts"],
				}),
			]),
		);
		// `cover` only touches a *.test.ts file, so it is a test card and must depend on the implementation it verifies.
		expect(result.violations).toHaveLength(1);
		expect(result.violations[0]).toContain("cover");
	});

	it("accepts a test card wired to the implementation it verifies", () => {
		const result = assessNKleinPlanTaskGraphQuality(
			graph([
				task({ id: "impl", title: "Implement bass synthesis" }),
				task({ id: "tests", title: "Add sequence rendering tests", dependsOn: ["impl"] }),
			]),
		);
		expect(result.violations).toHaveLength(0);
	});

	it("flags a documentation card with no dependency on delivered work", () => {
		const result = assessNKleinPlanTaskGraphQuality(
			graph([
				task({ id: "impl", title: "Implement kick synthesis" }),
				task({ id: "docs", title: "Update README usage notes" }),
			]),
		);
		expect(result.violations.some((violation) => violation.includes("docs"))).toBe(true);
	});

	it("warns (does not reject) on a likely reversed edge from impl to test", () => {
		const result = assessNKleinPlanTaskGraphQuality(
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
		const result = assessNKleinPlanTaskGraphQuality(
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
		const result = assessNKleinPlanTaskGraphQuality(
			graph([task({ id: "a", title: "Implement A" }), task({ id: "b", title: "Implement B" })]),
		);
		expect(result.warnings.some((warning) => warning.includes("sparse"))).toBe(false);
	});

	it("warns when a UI card ignores all domain/control cards", () => {
		const result = assessNKleinPlanTaskGraphQuality(
			graph([
				task({ id: "domain", title: "Define domain control metadata" }),
				task({ id: "ui", title: "Build the user interface screen", dependsOn: [] }),
			]),
		);
		expect(result.warnings.some((warning) => warning.includes("UI card"))).toBe(true);
	});
});

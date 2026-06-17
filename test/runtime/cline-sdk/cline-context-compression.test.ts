import { describe, expect, it } from "vitest";
import {
	buildCompressedContextPreview,
	compressKanbanContextText,
} from "../../../src/cline-sdk/cline-context-compression";

describe("cline context compression", () => {
	it("uses caveman-style compression for prose-heavy context", () => {
		const result = compressKanbanContextText(
			"The implementation should preserve the existing behavior and the tests should explain the regression.",
			{ maxTokens: 80 },
		);

		expect(result.mode).toBe("prose_caveman");
		expect(result.compressedTokens).toBeLessThan(result.originalTokens);
		expect(result.text).toContain("implementation");
		expect(result.text).toContain("regression");
	});

	it("uses code minification rather than token pruning for code-like context", () => {
		const result = compressKanbanContextText(
			[
				"export function calculateScore(value: number): number {",
				"  // Keep this code structurally valid enough for inspection.",
				"  const bounded = Math.max(0, value);",
				"  return bounded;",
				"}",
			].join("\n"),
			{ maxTokens: 100 },
		);

		expect(result.mode).toBe("code_minify");
		expect(result.text).toContain("calculateScore");
		expect(result.text).not.toContain("Keep this code structurally");
	});

	it("keeps model-assisted compression explicitly disabled until a safe provider is wired", () => {
		const result = compressKanbanContextText("Important facts must not be silently model-compressed.", {
			maxTokens: 20,
			allowModelAssisted: true,
		});

		expect(result.mode).toBe("model_assisted_disabled");
		expect(buildCompressedContextPreview("The user wants careful compression.", 40)).toContain(
			"older text compressed",
		);
	});
});

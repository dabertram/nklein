import { describe, expect, it } from "vitest";
import { parseNPatchCandidates } from "../../../src/core/patch-candidate-parser";
import { buildPatchGenerationPrompt } from "../../../src/core/patch-generation-prompt";

const base = {
	bugSummary: "`add(a, b)` returns a - b instead of a + b.",
	localizedContext: [{ ref: "src/math.ts:add", snippet: "export function add(a, b) {\n  return a - b;\n}" }],
	candidateCount: 3,
};

describe("buildPatchGenerationPrompt", () => {
	it("asks for exactly N distinct candidates in the fenced-diff format the parser expects", () => {
		const { system } = buildPatchGenerationPrompt(base);
		expect(system).toContain("EXACTLY 3 distinct candidate patches");
		expect(system).toContain("```diff");
		expect(system).toContain("diff --git a/<path> b/<path>");
		expect(system).toContain("+++ b/<path>");
		expect(system).toContain("NOTHING outside the fenced diff blocks");
	});

	it("puts the bug summary + localized refs/snippets in the user prompt", () => {
		const { user } = buildPatchGenerationPrompt(base);
		expect(user).toContain("returns a - b instead of a + b");
		expect(user).toContain("src/math.ts:add");
		expect(user).toContain("return a - b;");
	});

	it("echoes allowedPaths as a hard edit-scope constraint (agreeing with the parser's rejection boundary)", () => {
		const { system } = buildPatchGenerationPrompt({ ...base, allowedPaths: ["src/math.ts"] });
		expect(system).toContain("Edit ONLY these files");
		expect(system).toContain("src/math.ts");
	});

	it("falls back to a context-scoped edit rule when no allowedPaths are given", () => {
		const { system } = buildPatchGenerationPrompt(base);
		expect(system).toContain("Edit only the file(s) implicated by the localized context");
		expect(system).not.toContain("Edit ONLY these files");
	});

	it("clamps candidateCount to at least 1 and uses singular wording", () => {
		const { system, user } = buildPatchGenerationPrompt({ ...base, candidateCount: 0 });
		expect(system).toContain("EXACTLY 1 candidate patch");
		expect(user).toContain("Return 1 candidate patch");
		expect(system).not.toContain("candidate patches");
	});

	it("handles empty localized context without emitting a broken block", () => {
		const { user } = buildPatchGenerationPrompt({ ...base, localizedContext: [] });
		expect(user).toContain("no localized context was provided");
	});

	it("round-trips: a model reply in the prompted format parses into in-scope candidates", () => {
		// Simulate a compliant model reply in the exact format the prompt demands.
		const reply = [
			"```diff",
			"diff --git a/src/math.ts b/src/math.ts",
			"--- a/src/math.ts",
			"+++ b/src/math.ts",
			"@@ -1,3 +1,3 @@",
			" export function add(a, b) {",
			"-  return a - b;",
			"+  return a + b;",
			" }",
			"```",
			"```diff",
			"diff --git a/src/math.ts b/src/math.ts",
			"--- a/src/math.ts",
			"+++ b/src/math.ts",
			"@@ -1,3 +1,3 @@",
			"-  return a - b;",
			"+  return b + a;",
			"```",
		].join("\n");
		const parsed = parseNPatchCandidates(reply, { allowedPathPrefixes: ["src/math.ts"] });
		expect(parsed.candidates).toHaveLength(2);
		expect(parsed.rejected).toHaveLength(0);
		expect(parsed.candidates.every((c) => c.touchedPaths.includes("src/math.ts"))).toBe(true);
	});
});

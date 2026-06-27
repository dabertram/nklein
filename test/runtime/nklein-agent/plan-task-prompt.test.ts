import { describe, expect, it } from "vitest";
import {
	buildTaskPrompt,
	formatSharedPlanContext,
	truncateSharedContext,
} from "../../../src/nklein-agent/decomposition/plan-task-prompt";
import type { NKleinPlanTask } from "../../../src/nklein-agent/nklein-plan-artifacts";

function task(over: Partial<NKleinPlanTask> = {}): NKleinPlanTask {
	return {
		id: "t1",
		title: "Task 1",
		prompt: "update the greeting text",
		dependsOn: [],
		complexity: 40,
		suggestedRole: null,
		filesLikelyTouched: [],
		acceptanceCommand: null,
		testFirst: false,
		acceptanceTestPrompt: null,
		knowledgeDebt: null,
		...over,
	};
}

describe("truncateSharedContext", () => {
	it("returns short text trimmed and truncates long text with a marker", () => {
		expect(truncateSharedContext("  hello  ", 100)).toBe("hello");
		const truncated = truncateSharedContext("x".repeat(50), 10);
		expect(truncated.length).toBeLessThan(50);
		expect(truncated).toContain("[truncated]");
	});
});

describe("formatSharedPlanContext", () => {
	it("returns null when there is no shared context", () => {
		expect(formatSharedPlanContext(undefined)).toBeNull();
		expect(formatSharedPlanContext({ spec: "  ", decisionsMarkdown: null })).toBeNull();
	});

	it("renders spec and decisions sections when present", () => {
		const out = formatSharedPlanContext({ spec: "the spec", decisionsMarkdown: "the decisions" });
		expect(out).toContain("Shared spec:\nthe spec");
		expect(out).toContain("Shared decisions:\nthe decisions");
	});
});

describe("buildTaskPrompt", () => {
	it("always includes the task objective, leaf-scope, pace, and complexity", () => {
		const prompt = buildTaskPrompt(task({ prompt: "do the thing", complexity: 42.6 }));
		expect(prompt).toContain("do the thing");
		expect(prompt).toContain("Leaf scope:");
		expect(prompt).toContain("Execution pace:");
		expect(prompt).toContain("Complexity: 43/100"); // rounded
	});

	it("prepends the matching guidance skill command when the task implies a topic", () => {
		const prompt = buildTaskPrompt(task({ prompt: "harden the auth token validation" }));
		expect(prompt.startsWith("/nklein-security")).toBe(true);
		expect(prompt).toContain("Guidance topic: security");
	});

	it("omits the guidance prefix for a neutral task", () => {
		expect(buildTaskPrompt(task()).startsWith("/nklein")).toBe(false);
	});

	it("appends optional sections only when their fields are set", () => {
		const full = buildTaskPrompt(
			task({
				filesLikelyTouched: ["src/a.ts"],
				acceptanceCommand: "npm test",
				testFirst: true,
				acceptanceTestPrompt: "write the failing test",
				knowledgeDebt: "unsure about the API",
				suggestedRole: "worker",
			}),
			{ spec: "shared spec", decisionsMarkdown: null },
			"strong on TS",
		);
		expect(full).toContain("Likely files:\n- src/a.ts");
		expect(full).toContain("Acceptance check: npm test");
		expect(full).toContain("Test-first:");
		expect(full).toContain("write the failing test");
		expect(full).toContain("Knowledge debt");
		expect(full).toContain("Suggested role: worker");
		expect(full).toContain("Model fit: strong on TS");
		expect(full).toContain("Shared spec:\nshared spec");

		const minimal = buildTaskPrompt(task());
		expect(minimal).not.toContain("Likely files:");
		expect(minimal).not.toContain("Acceptance check:");
		expect(minimal).not.toContain("Test-first:");
		expect(minimal).not.toContain("Suggested role:");
	});
});

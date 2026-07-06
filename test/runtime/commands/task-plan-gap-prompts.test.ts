import { describe, expect, it } from "vitest";
import {
	buildIntegrationCardPrompt,
	buildPlanGapDecisionCardPrompt,
	buildPlanGapIntegrationCardPrompt,
	buildPlanGapScopeCardPrompt,
} from "../../../src/commands/task/task-plan-gap-prompts";
import type { TaskWorktreeAutoMergeConflict } from "../../../src/workspace/task-worktree-auto-merge";

const conflict = (over: Partial<TaskWorktreeAutoMergeConflict>): TaskWorktreeAutoMergeConflict =>
	({
		taskId: "t1",
		headCommit: "abc123",
		conflictedPaths: [],
		message: "merge failed",
		...over,
	}) as TaskWorktreeAutoMergeConflict;

describe("buildIntegrationCardPrompt (§5.V coverage)", () => {
	it("lists the conflicted paths as bullets and includes head/message/taskId", () => {
		const prompt = buildIntegrationCardPrompt(conflict({ conflictedPaths: ["a.ts", "b.ts"] }));
		expect(prompt).toContain('task "t1"');
		expect(prompt).toContain("Task head: abc123");
		expect(prompt).toContain("- a.ts\n- b.ts");
		expect(prompt).toContain("Git message: merge failed");
		expect(prompt.split("\n\n").length).toBeGreaterThan(1); // sections joined by blank lines
	});

	it("uses the no-paths fallback when git reported none", () => {
		expect(buildIntegrationCardPrompt(conflict({ conflictedPaths: [] }))).toContain(
			"No conflicted paths were reported by Git",
		);
	});
});

describe("buildPlanGapIntegrationCardPrompt (§5.V coverage)", () => {
	it("names the task, uses the description, and appends evidence only when present", () => {
		const withEvidence = buildPlanGapIntegrationCardPrompt({
			taskId: "t2",
			description: "  wire the module  ",
			evidence: "  see log  ",
		});
		expect(withEvidence).toContain('task "t2"');
		expect(withEvidence).toContain("wire the module");
		expect(withEvidence).toContain("Evidence: see log");

		const noEvidence = buildPlanGapIntegrationCardPrompt({ taskId: "t2", description: "x" });
		expect(noEvidence).not.toContain("Evidence:");
	});

	it("falls back to default text when the description is blank", () => {
		expect(buildPlanGapIntegrationCardPrompt({ taskId: "t2", description: "   " })).toContain(
			"the plan needs an integration step",
		);
	});
});

describe("buildPlanGapDecisionCardPrompt (§5.V coverage)", () => {
	it("labels a contradiction vs a missing decision by kind", () => {
		expect(
			buildPlanGapDecisionCardPrompt({ taskId: "t3", kind: "contradictory_requirement", description: "d" }),
		).toContain("Resolve the contradiction");
		expect(buildPlanGapDecisionCardPrompt({ taskId: "t3", kind: "missing_decision", description: "d" })).toContain(
			"Resolve the missing decision",
		);
	});

	it("appends trimmed evidence when present", () => {
		expect(
			buildPlanGapDecisionCardPrompt({
				taskId: "t3",
				kind: "missing_decision",
				description: "d",
				evidence: "  proof  ",
			}),
		).toContain("Evidence: proof");
	});
});

describe("buildPlanGapScopeCardPrompt (§5.V coverage)", () => {
	it("frames an oversized-task split and honors description/evidence", () => {
		const prompt = buildPlanGapScopeCardPrompt({ taskId: "t4", description: "too big", evidence: "metric" });
		expect(prompt).toContain('Split the oversized task reported by "t4"');
		expect(prompt).toContain("too big");
		expect(prompt).toContain("Evidence: metric");
	});

	it("uses the default text for a blank description", () => {
		expect(buildPlanGapScopeCardPrompt({ taskId: "t4", description: "" })).toContain(
			"too large for one autonomous task",
		);
	});
});

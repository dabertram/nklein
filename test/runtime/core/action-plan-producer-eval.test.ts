import { describe, expect, it } from "vitest";
import {
	ACTION_PLAN_PRODUCER_CASES,
	buildActionPlanProducerPrompt,
	buildActionPlanResponseSchema,
	scoreActionPlanCandidate,
} from "../../../src/core/action-plan-producer-eval";

describe("ActionPlan producer eval", () => {
	it("builds a strict bounded schema over only the offered tools", () => {
		const schema = buildActionPlanResponseSchema(["read_files", "run_command"]);
		expect(schema).toMatchObject({
			type: "object",
			additionalProperties: false,
			properties: { steps: { minItems: 1, maxItems: 6 } },
		});
		expect(JSON.stringify(schema)).toContain('"enum":["read_files","run_command"]');
	});

	it("accepts a semantic dependency path through an intermediate step", () => {
		const case_ = ACTION_PLAN_PRODUCER_CASES[0];
		expect(case_).toBeDefined();
		if (!case_) return;
		const result = scoreActionPlanCandidate(case_, {
			steps: [
				{ id: "read", tool: "read_files", args: {}, dependsOn: [] },
				{ id: "edit", tool: "edit_file", args: {}, dependsOn: ["read"] },
				{ id: "test", tool: "run_command", args: {}, dependsOn: ["edit"] },
			],
		});
		expect(result).toMatchObject({ score: 1, defects: [] });
	});

	it("rejects valid JSON that hallucinates tools, omits required work, or loses order", () => {
		const case_ = ACTION_PLAN_PRODUCER_CASES[0];
		expect(case_).toBeDefined();
		if (!case_) return;
		const result = scoreActionPlanCandidate(case_, {
			steps: [
				{ id: "edit", tool: "invent_tool", args: {}, dependsOn: [] },
				{ id: "test", tool: "run_command", args: {}, dependsOn: [] },
			],
		});
		expect(result.score).toBe(0);
		expect(result.defects).toEqual(
			expect.arrayContaining([
				"tool_not_allowed:invent_tool",
				"required_tool_missing:read_files",
				"required_tool_missing:edit_file",
				"precedence_missing:edit_file->run_command",
			]),
		);
	});

	it("keeps every case prompt explicit about the available manifest", () => {
		for (const case_ of ACTION_PLAN_PRODUCER_CASES) {
			const prompt = buildActionPlanProducerPrompt(case_);
			expect(prompt).toContain(case_.goal);
			for (const tool of case_.allowedTools) expect(prompt).toContain(tool);
		}
	});
});

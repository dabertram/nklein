import { describe, expect, it } from "vitest";
import {
	type ActionPlan,
	type ActionPlanStep,
	actionPlanSchema,
	actionPlanStepSchema,
	validateActionPlan,
} from "../../../src/core/action-plan-ir";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function step(over: Partial<ActionPlanStep> & { id: string; tool: string }): ActionPlanStep {
	return actionPlanStepSchema.parse({
		args: {},
		dependsOn: [],
		...over,
	});
}

function plan(steps: ActionPlanStep[]): ActionPlan {
	return actionPlanSchema.parse({ steps });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("validateActionPlan", () => {
	it("accepts a valid linear plan (no deps)", () => {
		const result = validateActionPlan(
			plan([
				step({ id: "a", tool: "read_file", args: { path: "/foo" } }),
				step({ id: "b", tool: "write_file", args: { path: "/bar" }, dependsOn: ["a"] }),
				step({ id: "c", tool: "notify", args: {}, dependsOn: ["b"] }),
			]),
		);
		expect(result.ok).toBe(true);
		expect(result.errors).toHaveLength(0);
	});

	it("accepts a valid diamond (fan-out → fan-in)", () => {
		// a → b, a → c, b + c → d
		const result = validateActionPlan(
			plan([
				step({ id: "a", tool: "fetch" }),
				step({ id: "b", tool: "parse-x", dependsOn: ["a"] }),
				step({ id: "c", tool: "parse-y", dependsOn: ["a"] }),
				step({ id: "d", tool: "merge", dependsOn: ["b", "c"] }),
			]),
		);
		expect(result.ok).toBe(true);
		expect(result.errors).toHaveLength(0);
	});

	it("reports an error for duplicate step ids", () => {
		const result = validateActionPlan(
			plan([step({ id: "a", tool: "tool1" }), step({ id: "a", tool: "tool2" }), step({ id: "b", tool: "tool3" })]),
		);
		expect(result.ok).toBe(false);
		expect(result.errors.some((e) => e.includes("duplicate") && e.includes('"a"'))).toBe(true);
	});

	it("reports an error for a dependsOn id that does not exist", () => {
		const result = validateActionPlan(
			plan([step({ id: "a", tool: "fetch" }), step({ id: "b", tool: "process", dependsOn: ["a", "ghost"] })]),
		);
		expect(result.ok).toBe(false);
		expect(result.errors.some((e) => e.includes('"ghost"') && e.includes("unknown"))).toBe(true);
	});

	it("reports an error for a 2-node dependency cycle", () => {
		// a → b and b → a
		const result = validateActionPlan(
			plan([step({ id: "a", tool: "tool1", dependsOn: ["b"] }), step({ id: "b", tool: "tool2", dependsOn: ["a"] })]),
		);
		expect(result.ok).toBe(false);
		expect(result.errors.some((e) => e.toLowerCase().includes("cycle"))).toBe(true);
	});

	it("reports an error when steps is empty", () => {
		const result = validateActionPlan(plan([]));
		expect(result.ok).toBe(false);
		expect(result.errors.some((e) => e.includes("at least one step"))).toBe(true);
	});
});

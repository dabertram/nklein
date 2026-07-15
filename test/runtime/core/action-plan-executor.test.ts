import { describe, expect, it, vi } from "vitest";
import { executeActionPlan } from "../../../src/core/action-plan-executor";
import type { ActionPlan } from "../../../src/core/action-plan-ir";

const okDispatch = async () => ({ ok: true, output: "done" });

describe("executeActionPlan (F3.T3)", () => {
	it("runs steps in dependency order and checkpoints each", async () => {
		const plan: ActionPlan = {
			steps: [
				{ id: "b", tool: "t", args: {}, dependsOn: ["a"] },
				{ id: "a", tool: "t", args: {}, dependsOn: [] },
				{ id: "c", tool: "t", args: {}, dependsOn: ["b"] },
			],
		};
		const order: string[] = [];
		const checkpoints: number[] = [];
		const result = await executeActionPlan(plan, {
			dispatch: async (step) => {
				order.push(step.id);
				return { ok: true, output: step.id };
			},
			onCheckpoint: (completed) => checkpoints.push(completed.length),
		});
		expect(result.status).toBe("completed");
		expect(order).toEqual(["a", "b", "c"]);
		expect(checkpoints).toEqual([1, 2, 3]);
	});

	it("passes prior outputs to each dispatched step", async () => {
		const plan: ActionPlan = {
			steps: [
				{ id: "a", tool: "t", args: {}, dependsOn: [] },
				{ id: "b", tool: "t", args: {}, dependsOn: ["a"] },
			],
		};
		const seen: Array<string[]> = [];
		await executeActionPlan(plan, {
			dispatch: async (_step, prior) => {
				seen.push([...prior.keys()]);
				return { ok: true, output: 1 };
			},
		});
		expect(seen).toEqual([[], ["a"]]);
	});

	it("stops on failure and skips transitively-dependent steps", async () => {
		const plan: ActionPlan = {
			steps: [
				{ id: "a", tool: "t", args: {}, dependsOn: [] },
				{ id: "b", tool: "t", args: {}, dependsOn: ["a"] },
				{ id: "c", tool: "t", args: {}, dependsOn: ["b"] },
				{ id: "d", tool: "t", args: {}, dependsOn: [] }, // independent — but after the failure, nothing else runs
			],
		};
		const result = await executeActionPlan(plan, {
			dispatch: async (step) => (step.id === "a" ? { ok: false, error: "boom" } : { ok: true }),
		});
		expect(result.status).toBe("failed");
		expect(result.failed).toMatchObject({ stepId: "a", ok: false, error: "boom" });
		expect(result.skipped).toEqual(["b", "c"]); // d had no dep on a, but execution halted at the failure
		expect(result.completed).toEqual([]);
	});

	it("rejects a structurally-invalid plan without dispatching", async () => {
		const plan: ActionPlan = { steps: [{ id: "a", tool: "t", args: {}, dependsOn: ["missing"] }] };
		const dispatch = vi.fn(okDispatch);
		const result = await executeActionPlan(plan, { dispatch });
		expect(result.status).toBe("invalid");
		expect(result.errors.length).toBeGreaterThan(0);
		expect(dispatch).not.toHaveBeenCalled();
	});
});

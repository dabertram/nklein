import { describe, expect, it, vi } from "vitest";
import { RUNTIME_NKLEIN_DEFAULT_CONTEXT_WINDOW_TOKENS } from "../../../src/core/api-contract";
import {
	type ContextBudgetControllerDeps,
	createContextBudgetController,
} from "../../../src/nklein-agent/nklein-context-budget-controller";

function deps(over: Partial<ContextBudgetControllerDeps> = {}): ContextBudgetControllerDeps {
	return {
		getModelIdForTask: vi.fn(() => null),
		getQualityBudget: vi.fn(() => null),
		recordObservation: vi.fn(),
		...over,
	};
}

describe("resolveContextWindowForTask (§5.U extraction)", () => {
	it("stores + returns the truncated launch window when it is a positive finite number", () => {
		const c = createContextBudgetController(deps());
		expect(c.resolveContextWindowForTask("t1", 40_000.9)).toBe(40_000); // Math.trunc
		// subsequent no-arg resolve reads the stored value
		expect(c.resolveContextWindowForTask("t1")).toBe(40_000);
	});

	it("returns the stored value (or null) when the launch window is missing / non-positive", () => {
		const c = createContextBudgetController(deps());
		expect(c.resolveContextWindowForTask("t1", 0)).toBeNull(); // 0 is not > 0 → no store; store.get miss → null
		expect(c.resolveContextWindowForTask("t1", -5)).toBeNull();
		expect(c.resolveContextWindowForTask("t1", null)).toBeNull();
	});
});

describe("resolveKnownContextWindowForTask (§5.U extraction)", () => {
	it("falls back to the runtime default when nothing is stored and no launch window is given", () => {
		const c = createContextBudgetController(deps());
		expect(c.resolveKnownContextWindowForTask("t1")).toBe(RUNTIME_NKLEIN_DEFAULT_CONTEXT_WINDOW_TOKENS);
	});

	it("derates by the learned quality budget (Math.min) when the model's ledger has a lower knee", () => {
		const c = createContextBudgetController(
			deps({ getModelIdForTask: () => "m1", getQualityBudget: (id) => (id === "m1" ? 20_000 : null) }),
		);
		// advertised 60k, quality knee 20k → capped to 20k
		expect(c.resolveKnownContextWindowForTask("t1", 60_000)).toBe(20_000);
	});

	it("does NOT derate when the quality budget is above the advertised window", () => {
		const c = createContextBudgetController(deps({ getModelIdForTask: () => "m1", getQualityBudget: () => 100_000 }));
		expect(c.resolveKnownContextWindowForTask("t1", 40_000)).toBe(40_000);
	});
});

describe("prepareMessagesForKnownContextWindow (§5.U extraction)", () => {
	it("returns undefined (no compaction, no guard observation) for a tiny prompt in a large window", () => {
		const d = deps();
		const c = createContextBudgetController(d);
		expect(
			c.prepareMessagesForKnownContextWindow({ taskId: "t1", prompt: "hi", contextWindow: 128_000 }),
		).toBeUndefined();
		expect(d.recordObservation).not.toHaveBeenCalled();
	});
});

describe("lifecycle (§5.U extraction)", () => {
	it("forget drops a single task's stored window; clear drops all", () => {
		const c = createContextBudgetController(deps());
		c.resolveContextWindowForTask("t1", 40_000);
		c.resolveContextWindowForTask("t2", 50_000);
		c.forget("t1");
		expect(c.resolveContextWindowForTask("t1")).toBeNull();
		expect(c.resolveContextWindowForTask("t2")).toBe(50_000);
		c.clear();
		expect(c.resolveContextWindowForTask("t2")).toBeNull();
	});
});

import { describe, expect, it } from "vitest";
import { compressPlanForInjection, type PlanCursorTask } from "../../../src/core/plan-cursor.js";

/** opencode-swarm plan_cursor port — token-bounded compressed plan injection. */

const task = (
	id: string,
	phase: string,
	status: PlanCursorTask["status"],
	detail = `detail for ${id}`,
): PlanCursorTask => ({
	id,
	title: `Task ${id}`,
	phase,
	detail,
	status,
});

describe("compressPlanForInjection", () => {
	it("collapses done phases to a tally, full-details the cursor + lookahead, one-lines the rest", () => {
		const tasks = [
			task("1", "P1", "done"),
			task("2", "P1", "done"),
			task("3", "P2", "active"),
			task("4", "P2", "pending"),
			task("5", "P2", "pending"),
			task("6", "P3", "pending"),
		];
		const result = compressPlanForInjection({ tasks, currentTaskId: "3" }, { maxTokens: 5000, lookaheadTasks: 1 });
		expect(result.text).toContain("✓ P1: 2/2 done");
		// cursor (3) + 1 lookahead (4) = full detail; 5 and 6 = one-line.
		expect(result.fullDetailCount).toBe(2);
		expect(result.text).toContain("detail for 3");
		expect(result.text).toContain("detail for 4");
		expect(result.text).not.toContain("detail for 5");
		expect(result.text).toContain("· [P2] Task 5");
		expect(result.summarizedCount).toBe(2);
	});

	it("resolves the cursor to the first non-done task when no id is given", () => {
		const tasks = [task("1", "P1", "done"), task("2", "P1", "pending"), task("3", "P1", "pending")];
		const result = compressPlanForInjection({ tasks }, { maxTokens: 5000, lookaheadTasks: 0 });
		// Cursor = task 2 (first non-done); only it is full detail with lookahead 0.
		expect(result.fullDetailCount).toBe(1);
		expect(result.text).toContain("detail for 2");
		expect(result.text).not.toContain("detail for 3");
	});

	it("degrades farthest-future full entries to fit maxTokens but never drops the cursor's detail", () => {
		const longDetail = "x".repeat(4000); // ~1000 tokens each
		const tasks = [
			task("1", "P1", "active", longDetail),
			task("2", "P1", "pending", longDetail),
			task("3", "P1", "pending", longDetail),
		];
		// Budget only fits ~1 full detail → cursor (1) stays full, 2 and 3 degrade to title-only.
		const result = compressPlanForInjection({ tasks, currentTaskId: "1" }, { maxTokens: 1200, lookaheadTasks: 2 });
		expect(result.estimatedTokens).toBeLessThanOrEqual(1200);
		expect(result.text).toContain(longDetail); // the cursor's detail survives
		expect(result.fullDetailCount).toBe(1);
	});

	it("handles an all-done plan (cursor past the end) with only tally lines", () => {
		const tasks = [task("1", "P1", "done"), task("2", "P1", "done")];
		const result = compressPlanForInjection({ tasks });
		expect(result.text).toContain("✓ P1: 2/2 done");
		expect(result.fullDetailCount).toBe(0);
		expect(result.summarizedCount).toBe(0);
	});
});

import { describe, expect, it } from "vitest";
import { classifyDevTestRun, type DevTestBoardCounts } from "../../src/core/dev-test-outcome";

/**
 * P20.1b — the null-agent baseline run against OUR OWN grader (`classifyDevTestRun`).
 *
 * P20.1 says to do this first, because if an agent that does nothing scores a pass then every other number the
 * grader produced is meaningless. These are the FORGERY_VECTORS applied to the real function rather than to a
 * description of it.
 */

function counts(overrides: Partial<DevTestBoardCounts> = {}): DevTestBoardCounts {
	return {
		completed: 0,
		review: 0,
		planning: 0,
		ready: 0,
		inProgress: 0,
		backlog: 0,
		failed: 0,
		trash: 0,
		...overrides,
	};
}

describe("null agent vs classifyDevTestRun", () => {
	it("an EMPTY board does not read as completed — the null agent scores nothing", () => {
		// A board where nothing materialised trivially has zero incomplete cards. This previously reported a false
		// green (see the comment in dev-test-outcome.ts) and is now guarded.
		const result = classifyDevTestRun({ counts: counts(), acceptancePassed: null, runtimeReachable: true });
		expect(result.outcome).not.toBe("completed");
	});

	it("a board where everything was TRASHED does not read as completed", () => {
		// The cheapest possible forgery: discard every card and the incomplete count reaches zero.
		const result = classifyDevTestRun({
			counts: counts({ trash: 12 }),
			acceptancePassed: null,
			runtimeReachable: true,
		});
		expect(result.outcome).not.toBe("completed");
	});

	it("acceptance passing while NO card completed does not read as completed", () => {
		// The 'trivial validator satisfaction' vector: make the acceptance command succeed without doing the work.
		const result = classifyDevTestRun({
			counts: counts({ backlog: 10 }),
			acceptancePassed: true,
			runtimeReachable: true,
		});
		expect(result.outcome).not.toBe("completed");
		expect(result.outcome).toBe("acceptance_green_workflow_incomplete");
	});

	it("an unreachable runtime does not read as completed", () => {
		const result = classifyDevTestRun({ counts: counts(), acceptancePassed: null, runtimeReachable: false });
		expect(result.outcome).toBe("runtime_down");
	});

	it("STATE TAMPERING cannot forge a pass without independent acceptance evidence", () => {
		const forged = classifyDevTestRun({
			counts: counts({ completed: 30 }),
			acceptancePassed: null,
			runtimeReachable: true,
		});
		expect(forged.outcome).toBe("acceptance_not_run");
		expect(forged.success).toBe(false);
	});

	it("distinguishes an accepted completion from a board-only claim", () => {
		const real = classifyDevTestRun({
			counts: counts({ completed: 30 }),
			acceptancePassed: true,
			runtimeReachable: true,
		});
		const forged = classifyDevTestRun({
			counts: counts({ completed: 30 }),
			acceptancePassed: null,
			runtimeReachable: true,
		});
		expect(real.outcome).toBe("completed");
		expect(forged.outcome).toBe("acceptance_not_run");
	});
});

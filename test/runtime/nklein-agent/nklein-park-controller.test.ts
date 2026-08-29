import { describe, expect, it, vi } from "vitest";
import type { RuntimeTaskSessionSummary } from "../../../src/core/api-contract";
import { createParkController, type ParkControllerDeps } from "../../../src/nklein-agent/nklein-park-controller";
import type { NKleinTaskSessionEntry } from "../../../src/nklein-agent/nklein-session-state";

const summary = (over: Partial<RuntimeTaskSessionSummary>): RuntimeTaskSessionSummary =>
	({ taskId: "t1", state: "running", ...over }) as RuntimeTaskSessionSummary;

const entry = (state = "running"): NKleinTaskSessionEntry =>
	({
		summary: summary({ state: state as RuntimeTaskSessionSummary["state"] }),
		messages: [],
		activeAssistantMessageId: null,
		activeReasoningMessageId: null,
		toolMessageIdByToolCallId: new Map(),
		toolInputByToolCallId: new Map(),
	}) as unknown as NKleinTaskSessionEntry;

function deps(over: Partial<ParkControllerDeps> = {}): ParkControllerDeps {
	return {
		getTaskEntry: vi.fn(() => entry()),
		listSummaries: vi.fn(() => []),
		emitSummary: vi.fn(),
		emitMessage: vi.fn(),
		clearTaskTimeouts: vi.fn(),
		checkAutonomyBudget: vi.fn(() => null),
		resetAutonomyBudget: vi.fn(),
		resetRepeatedToolCallGuard: vi.fn(),
		markTaskParked: vi.fn(),
		abortTaskSession: vi.fn(() => Promise.resolve()),
		getTaskSessionId: vi.fn(() => "session-bound-at-decision"),
		recordObservation: vi.fn(),
		...over,
	};
}

const parkInput = () => ({ taskId: "t1", entry: entry(), message: "paused", metadata: { guardrail: "x" } });

describe("parkTaskForPause (§5.U extraction)", () => {
	it("resets guards, marks parked, aborts, records, emits a message, and returns a paused summary", () => {
		const d = deps();
		const controller = createParkController(d);
		const result = controller.parkTaskForPause(parkInput());

		expect(d.clearTaskTimeouts).toHaveBeenCalledWith("t1");
		expect(d.resetAutonomyBudget).toHaveBeenCalledWith("t1");
		expect(d.resetRepeatedToolCallGuard).toHaveBeenCalledWith("t1");
		expect(d.markTaskParked).toHaveBeenCalledWith("t1");
		expect(d.abortTaskSession).toHaveBeenCalledWith("t1", { expectedSessionId: "session-bound-at-decision" });
		expect(d.recordObservation).toHaveBeenCalledWith(expect.objectContaining({ signal: "custom", taskId: "t1" }));
		expect(d.emitMessage).toHaveBeenCalled(); // park system message
		expect(result.state).toBe("paused");
		expect(result.reviewReason).toBeNull();
	});

	it("skips the abort entirely when no session is bound at the park decision (idle card)", () => {
		// The fire-and-forget abort used to resolve the task binding at EXECUTION time, so pausing an idle
		// card could kill a session started moments later (proven live 2026-08-30: a pause aborted the
		// plan-mode architect the ingress auto-start had just spawned). Idle at decision time = no abort.
		const d = deps({ getTaskSessionId: vi.fn(() => null) });
		const result = createParkController(d).parkTaskForPause(parkInput());
		expect(d.abortTaskSession).not.toHaveBeenCalled();
		expect(result.state).toBe("paused");
	});
});

describe("parkTaskForAutonomyBudget (§5.U extraction)", () => {
	it("parks to awaiting_review/attention and does NOT mark an operator pause", () => {
		const d = deps();
		const result = createParkController(d).parkTaskForAutonomyBudget(parkInput());
		expect(d.markTaskParked).not.toHaveBeenCalled();
		expect(d.recordObservation).toHaveBeenCalledWith(expect.objectContaining({ signal: "budget_wall" }));
		expect(result.state).toBe("awaiting_review");
		expect(result.reviewReason).toBe("attention");
	});
});

describe("parkActiveTasksForOperatorPause (§5.U extraction)", () => {
	it("parks only running/queued tasks, emitting a summary for each", () => {
		const running = summary({ taskId: "run", state: "running" });
		const done = summary({ taskId: "done", state: "failed" }); // non-running/queued → skipped
		const d = deps({
			listSummaries: vi.fn(() => [running, done]),
			getTaskEntry: vi.fn((id: string) => (id === "run" ? entry() : entry("failed"))),
		});
		createParkController(d).parkActiveTasksForOperatorPause();
		expect(d.emitSummary).toHaveBeenCalledTimes(1); // only the running task
	});
});

describe("enforceAutonomyBudgets (§5.U extraction)", () => {
	it("returns null when there is no entry, else the budget-check result", () => {
		expect(
			createParkController(deps({ getTaskEntry: () => null })).enforceAutonomyBudgets("t1", {} as never),
		).toBeNull();
		const guarded = summary({ state: "awaiting_review" });
		const controller = createParkController(deps({ checkAutonomyBudget: () => guarded }));
		expect(controller.enforceAutonomyBudgets("t1", {} as never)).toBe(guarded);
	});
});

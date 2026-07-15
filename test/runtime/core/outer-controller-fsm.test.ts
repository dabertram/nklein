import { describe, expect, it } from "vitest";
import {
	advanceController,
	type ControllerState,
	classifyLifecyclePhase,
	INITIAL_CONTROLLER_STATE,
	isTerminalPhase,
	projectCardControllerTrace,
	runControllerSequence,
} from "../../../src/core/outer-controller-fsm.js";

/** F3.12 — the outer-controller FSM: orient→plan→act→verify→repair→finish, bounded. */

describe("advanceController", () => {
	const s = (phase: ControllerState["phase"], repairCount = 0): ControllerState => ({ phase, repairCount });

	it("advances the happy path orient→plan→act→verify→finish on ok outcomes", () => {
		expect(advanceController(s("orient"), "ok").phase).toBe("plan");
		expect(advanceController(s("plan"), "ok").phase).toBe("act");
		expect(advanceController(s("act"), "ok").phase).toBe("verify");
		expect(advanceController(s("verify"), "ok").phase).toBe("finish");
	});

	it("routes verify/act needs_repair to repair, then repair back to act (counting the cycle)", () => {
		expect(advanceController(s("verify"), "needs_repair").phase).toBe("repair");
		const afterRepair = advanceController(s("repair", 0), "ok");
		expect(afterRepair).toEqual({ phase: "act", repairCount: 1 });
	});

	it("fails immediately on a blocked outcome from any phase", () => {
		expect(advanceController(s("act"), "blocked").phase).toBe("failed");
		expect(advanceController(s("plan"), "blocked").phase).toBe("failed");
	});

	it("fails out when the repair cap is exceeded instead of looping forever", () => {
		// maxRepairCycles default 3 → the 4th repair transitions to failed.
		expect(advanceController(s("repair", 3), "ok").phase).toBe("failed");
		expect(advanceController(s("repair", 2), "ok")).toEqual({ phase: "act", repairCount: 3 });
	});

	it("terminal phases are absorbing", () => {
		expect(advanceController(s("finish"), "ok")).toEqual(s("finish"));
		expect(advanceController(s("failed"), "needs_repair")).toEqual(s("failed"));
		expect(isTerminalPhase("finish")).toBe(true);
		expect(isTerminalPhase("act")).toBe(false);
	});
});

describe("runControllerSequence", () => {
	it("reaches finish on a clean run", () => {
		expect(runControllerSequence(["ok", "ok", "ok", "ok"]).phase).toBe("finish");
	});

	it("reaches finish after a bounded repair loop", () => {
		// orient,plan,act(ok)→verify(needs_repair)→repair(ok)→act(ok)→verify(ok)→finish
		const end = runControllerSequence(["ok", "ok", "ok", "needs_repair", "ok", "ok", "ok"]);
		expect(end.phase).toBe("finish");
		expect(end.repairCount).toBe(1);
	});

	it("starts at orient and fails after too many repair cycles", () => {
		expect(INITIAL_CONTROLLER_STATE.phase).toBe("orient");
		// Force repeated verify-fail→repair loops until the cap fails it out.
		const end = runControllerSequence([
			"ok",
			"ok",
			"ok", // → verify
			"needs_repair",
			"ok", // repair 1 → act
			"ok",
			"needs_repair",
			"ok", // act→verify fail→repair 2→act
			"ok",
			"needs_repair",
			"ok", // repair 3→act
			"ok",
			"needs_repair",
			"ok", // repair 4 → failed
		]);
		expect(end.phase).toBe("failed");
	});
});

describe("lifecycle projection (F3.12 observability)", () => {
	it("maps real card transitions onto controller phases", () => {
		expect(classifyLifecyclePhase("wf:planning")).toBe("plan");
		expect(classifyLifecyclePhase("running")).toBe("act");
		expect(classifyLifecyclePhase("awaiting_review")).toBe("verify");
		expect(classifyLifecyclePhase("delivery_merge")).toBe("finish");
		expect(classifyLifecyclePhase("review_changes_requested")).toBe("repair");
		expect(classifyLifecyclePhase("delivery_open_pr")).toBe("repair");
		expect(classifyLifecyclePhase("trouble_silent")).toBe("repair");
		expect(classifyLifecyclePhase("failed")).toBe("failed");
		expect(classifyLifecyclePhase("some:unrelated")).toBeNull();
	});

	it("projects a card's transitions into a deduped phase trace", () => {
		const trace = projectCardControllerTrace([
			"wf:planning",
			"running",
			"running", // dedup consecutive
			"awaiting_review",
			"delivery_open_pr", // review not approved → repair
			"running", // re-work
			"awaiting_review",
			"delivery_merge",
		]);
		expect(trace).toEqual(["plan", "act", "verify", "repair", "act", "verify", "finish"]);
	});
});

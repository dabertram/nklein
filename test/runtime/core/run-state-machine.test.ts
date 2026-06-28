import { describe, expect, it } from "vitest";
import { decideNextPhase, isTerminalRunPhase, type RunPhase } from "../../../src/core/run-state-machine";

describe("run-state-machine — phase ladder", () => {
	it("walks the nominal forward path on clean evidence", () => {
		expect(decideNextPhase("intake", {}).next).toBe("plan");
		expect(decideNextPhase("plan", {}).next).toBe("validate_plan");
		expect(decideNextPhase("validate_plan", { planValid: true }).next).toBe("localize");
		expect(decideNextPhase("localize", { localized: true }).next).toBe("execute_step");
		expect(decideNextPhase("execute_step", {}).next).toBe("observe");
		expect(decideNextPhase("observe", {}).next).toBe("evaluate");
		expect(decideNextPhase("evaluate", { allStepsComplete: true }).next).toBe("review");
		expect(decideNextPhase("review", { reviewPassed: true }).next).toBe("merge_or_escalate");
		expect(decideNextPhase("merge_or_escalate", {}).next).toBe("done");
	});

	it("HARD GUARD: never reaches execute_step (repo mutation) before localization is proven", () => {
		expect(decideNextPhase("localize", {}).next).toBe("localize"); // not localized → stay
		expect(decideNextPhase("localize", { localized: false }).next).toBe("localize");
		expect(decideNextPhase("localize", { localized: true }).next).toBe("execute_step");
	});

	it("an invalid plan replans rather than acting on it", () => {
		expect(decideNextPhase("validate_plan", { planValid: false }).next).toBe("plan");
		expect(decideNextPhase("validate_plan", {}).next).toBe("plan"); // unproven ⇒ conservative
	});

	it("completion is EVIDENCE-based: a succeeded step that isn't the last drives the next step, not done", () => {
		// The §5.Z e2e lesson: a model that 'declares all steps done' must NOT finish the run without acceptance evidence.
		expect(decideNextPhase("evaluate", { stepSucceeded: true, allStepsComplete: false }).next).toBe("execute_step");
		expect(decideNextPhase("evaluate", { allStepsComplete: true }).next).toBe("review");
	});

	it("a step with no observed effect goes to repair, not forward", () => {
		expect(decideNextPhase("evaluate", { stepSucceeded: false }).next).toBe("repair");
		expect(decideNextPhase("evaluate", {}).next).toBe("repair"); // no evidence of success ⇒ repair
	});

	it("repair → retry_or_split branches on evidence (split / escalate / retry)", () => {
		expect(decideNextPhase("repair", { repairSucceeded: true }).next).toBe("evaluate");
		expect(decideNextPhase("repair", { repairSucceeded: false }).next).toBe("retry_or_split");
		expect(decideNextPhase("retry_or_split", { needsSplit: true }).next).toBe("plan");
		expect(decideNextPhase("retry_or_split", { rungsExhausted: true }).next).toBe("escalate");
		expect(decideNextPhase("retry_or_split", {}).next).toBe("execute_step"); // untried rung remains → retry
	});

	it("a failed review repairs before finishing", () => {
		expect(decideNextPhase("review", { reviewPassed: false }).next).toBe("repair");
	});

	it("budget exhaustion parks from any non-terminal phase", () => {
		const phases: RunPhase[] = ["plan", "localize", "execute_step", "evaluate", "repair", "review"];
		for (const phase of phases) {
			expect(decideNextPhase(phase, { budgetExhausted: true, planValid: true, localized: true }).next).toBe("park");
		}
	});

	it("terminal phases are stable and reported as terminal", () => {
		for (const phase of ["done", "park", "escalate"] as RunPhase[]) {
			expect(isTerminalRunPhase(phase)).toBe(true);
			expect(decideNextPhase(phase, { budgetExhausted: true }).next).toBe(phase); // no park-override from terminal
		}
		expect(isTerminalRunPhase("execute_step")).toBe(false);
	});
});

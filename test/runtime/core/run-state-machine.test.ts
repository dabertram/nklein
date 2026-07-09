import { describe, expect, it } from "vitest";
import {
	decideNextPhase,
	driveRunPhaseFlow,
	isTerminalRunPhase,
	isToolAllowedInPhase,
	type RunPhase,
	runPhasePolicy,
	selectPhaseTools,
} from "../../../src/core/run-state-machine";

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

describe("run-state-machine — full phase flow driver", () => {
	it("drives the full evidence-owned flow end-to-end and captures each phase budget", () => {
		const result = driveRunPhaseFlow({
			evidenceForPhase: (phase, transitions) => {
				if (phase === "validate_plan") {
					return { planValid: true };
				}
				if (phase === "localize") {
					return { localized: true };
				}
				if (phase === "evaluate") {
					const evaluateCount = transitions.filter((transition) => transition.from === "evaluate").length;
					return evaluateCount === 0
						? { stepSucceeded: true, allStepsComplete: false }
						: { allStepsComplete: true };
				}
				if (phase === "review") {
					return { reviewPassed: true };
				}
				return {};
			},
		});

		expect(result.stoppedReason).toBe("terminal");
		expect(result.finalPhase).toBe("done");
		expect(result.transitions.map((transition) => transition.from)).toEqual([
			"intake",
			"plan",
			"validate_plan",
			"localize",
			"execute_step",
			"observe",
			"evaluate",
			"execute_step",
			"observe",
			"evaluate",
			"review",
			"merge_or_escalate",
		]);
		expect(result.transitions.find((transition) => transition.from === "execute_step")?.policy.maxToolCalls).toBe(
			runPhasePolicy("execute_step").maxToolCalls,
		);
	});

	it("stops as stalled when evidence cannot advance a non-terminal phase", () => {
		const result = driveRunPhaseFlow({
			initialPhase: "localize",
			evidenceForPhase: () => ({}),
		});

		expect(result).toMatchObject({
			finalPhase: "localize",
			stoppedReason: "stalled",
		});
		expect(result.transitions).toHaveLength(1);
		expect(result.transitions[0]).toMatchObject({
			from: "localize",
			to: "localize",
			reason: "Not yet localized — repo mutation is forbidden until it is.",
		});
	});

	it("parks when a phase budget is exhausted", () => {
		const result = driveRunPhaseFlow({
			initialPhase: "execute_step",
			evidenceForPhase: () => ({ budgetExhausted: true }),
		});

		expect(result.finalPhase).toBe("park");
		expect(result.stoppedReason).toBe("terminal");
		expect(result.transitions.map((transition) => transition.to)).toEqual(["park"]);
	});
});

describe("run-state-machine — per-phase tool/budget policy", () => {
	it("planning + assessment phases are read-only (no repo mutation), execute/repair allow sandbox writes", () => {
		expect(runPhasePolicy("validate_plan").maxMutationLevel).toBe("read");
		expect(runPhasePolicy("localize").maxMutationLevel).toBe("read"); // the hard guard, mirrored in policy
		expect(runPhasePolicy("observe").maxMutationLevel).toBe("read");
		expect(runPhasePolicy("execute_step").maxMutationLevel).toBe("sandbox_write");
		expect(runPhasePolicy("repair").maxMutationLevel).toBe("sandbox_write");
		expect(runPhasePolicy("plan").maxMutationLevel).toBe("control_plane");
		expect(runPhasePolicy("merge_or_escalate").maxMutationLevel).toBe("control_plane");
	});

	it("terminal phases drive no tools", () => {
		for (const phase of ["done", "park", "escalate"] as RunPhase[]) {
			expect(runPhasePolicy(phase).maxToolCalls).toBe(0);
		}
	});

	it("isToolAllowedInPhase enforces ≤ the phase's max mutation level (no mutation before/at localization)", () => {
		// localize is read-only → a sandbox write is forbidden there but a read is fine.
		expect(isToolAllowedInPhase("localize", "read")).toBe(true);
		expect(isToolAllowedInPhase("localize", "sandbox_write")).toBe(false);
		// execute_step permits sandbox writes but never a host write.
		expect(isToolAllowedInPhase("execute_step", "sandbox_write")).toBe(true);
		expect(isToolAllowedInPhase("execute_step", "host_write")).toBe(false);
		// control-plane phases permit a board mutation but still not a host write.
		expect(isToolAllowedInPhase("plan", "control_plane")).toBe(true);
		expect(isToolAllowedInPhase("plan", "host_write")).toBe(false);
	});
});

describe("run-state-machine — selectPhaseTools", () => {
	const tools = [
		{ name: "read_file", mutationLevel: "read" as const },
		{ name: "write_file", mutationLevel: "sandbox_write" as const },
		{ name: "create_card", mutationLevel: "control_plane" as const },
		{ name: "host_shell", mutationLevel: "host_write" as const },
	];

	it("localize (read-only) offers only read tools — no mutation before localization", () => {
		expect(selectPhaseTools("localize", tools).map((t) => t.name)).toEqual(["read_file"]);
	});

	it("execute_step offers read + sandbox_write, but never control_plane or host_write", () => {
		expect(selectPhaseTools("execute_step", tools).map((t) => t.name)).toEqual(["read_file", "write_file"]);
	});

	it("plan (control_plane) offers read + sandbox + control_plane, never host_write", () => {
		expect(selectPhaseTools("plan", tools).map((t) => t.name)).toEqual(["read_file", "write_file", "create_card"]);
	});
});

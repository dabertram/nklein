import { describe, expect, it } from "vitest";
import {
	type BackgroundEvalAdmissionInput,
	decideBackgroundEvalAdmission,
} from "../../../src/core/background-eval-admission";

const ADMISSIBLE: BackgroundEvalAdmissionInput = {
	hasInteractiveWork: false,
	loadedModelIdle: true,
	runningBackgroundEvals: 0,
	maxBackgroundEvals: 2,
	resourceHeadroom: true,
};

describe("decideBackgroundEvalAdmission", () => {
	it("admits when idle with capacity and headroom", () => {
		expect(decideBackgroundEvalAdmission(ADMISSIBLE)).toEqual({ admit: true, reason: "idle_capacity_available" });
	});

	it("ALWAYS yields to interactive work first (even if everything else would admit)", () => {
		const decision = decideBackgroundEvalAdmission({ ...ADMISSIBLE, hasInteractiveWork: true });
		expect(decision).toEqual({ admit: false, reason: "yield_to_interactive" });
	});

	it("yields to interactive even when no model is idle and the cap is reached (priority order)", () => {
		const decision = decideBackgroundEvalAdmission({
			...ADMISSIBLE,
			hasInteractiveWork: true,
			loadedModelIdle: false,
			runningBackgroundEvals: 5,
			resourceHeadroom: false,
		});
		expect(decision.reason).toBe("yield_to_interactive");
	});

	it("holds when no model is idle", () => {
		expect(decideBackgroundEvalAdmission({ ...ADMISSIBLE, loadedModelIdle: false })).toEqual({
			admit: false,
			reason: "no_idle_loaded_model",
		});
	});

	it("holds at the background concurrency cap", () => {
		expect(
			decideBackgroundEvalAdmission({ ...ADMISSIBLE, runningBackgroundEvals: 2, maxBackgroundEvals: 2 }),
		).toEqual({ admit: false, reason: "background_cap_reached" });
	});

	it("a cap of 0 disables the rail", () => {
		expect(decideBackgroundEvalAdmission({ ...ADMISSIBLE, maxBackgroundEvals: 0 }).reason).toBe(
			"background_cap_reached",
		);
	});

	it("holds when there is no composed resource headroom", () => {
		expect(decideBackgroundEvalAdmission({ ...ADMISSIBLE, resourceHeadroom: false })).toEqual({
			admit: false,
			reason: "no_resource_headroom",
		});
	});
});

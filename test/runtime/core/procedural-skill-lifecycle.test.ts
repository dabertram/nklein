import { describe, expect, it } from "vitest";
import {
	decideSkillLifecycleTransition,
	type SkillLifecycleSignals,
} from "../../../src/core/procedural-skill-lifecycle";

function signals(overrides: Partial<SkillLifecycleSignals>): SkillLifecycleSignals {
	return {
		status: "candidate",
		validationPassed: null,
		deltaVsBaseline: null,
		falseActivationRate: null,
		...overrides,
	};
}

describe("procedural skill lifecycle (§5.AE safety keystone)", () => {
	it("a candidate ALWAYS enters quarantine — never auto-activates", () => {
		const d = decideSkillLifecycleTransition(
			// Even with perfect signals, a candidate cannot jump to active.
			signals({ status: "candidate", validationPassed: true, deltaVsBaseline: 0.5, falseActivationRate: 0 }),
		);
		expect(d.nextStatus).toBe("quarantined");
		expect(d.changed).toBe(true);
	});

	it("promotes a quarantined skill only with passed validation + positive delta + low false-activation", () => {
		const d = decideSkillLifecycleTransition(
			signals({ status: "quarantined", validationPassed: true, deltaVsBaseline: 0.3, falseActivationRate: 0.05 }),
		);
		expect(d.nextStatus).toBe("active");
	});

	it("deprecates a quarantined skill that FAILED validation", () => {
		expect(
			decideSkillLifecycleTransition(signals({ status: "quarantined", validationPassed: false })).nextStatus,
		).toBe("deprecated");
	});

	it("deprecates a quarantined skill with a non-positive delta", () => {
		expect(
			decideSkillLifecycleTransition(signals({ status: "quarantined", validationPassed: true, deltaVsBaseline: 0 }))
				.nextStatus,
		).toBe("deprecated");
	});

	it("blocks promotion (stays quarantined) when validation passed but false-activation is too high", () => {
		const d = decideSkillLifecycleTransition(
			signals({ status: "quarantined", validationPassed: true, deltaVsBaseline: 0.4, falseActivationRate: 0.5 }),
		);
		expect(d.nextStatus).toBe("quarantined");
		expect(d.changed).toBe(false);
	});

	it("stays quarantined when the evidence is incomplete", () => {
		expect(
			decideSkillLifecycleTransition(signals({ status: "quarantined", validationPassed: true })).nextStatus,
		).toBe("quarantined");
	});

	it("deprecates an active skill on rising false-activation (negative transfer)", () => {
		expect(
			decideSkillLifecycleTransition(signals({ status: "active", deltaVsBaseline: 0.2, falseActivationRate: 0.3 }))
				.nextStatus,
		).toBe("deprecated");
	});

	it("deprecates an active skill whose delta went non-positive", () => {
		expect(
			decideSkillLifecycleTransition(signals({ status: "active", deltaVsBaseline: -0.1, falseActivationRate: 0 }))
				.nextStatus,
		).toBe("deprecated");
	});

	it("keeps an active skill that still validates positively", () => {
		const d = decideSkillLifecycleTransition(
			signals({ status: "active", deltaVsBaseline: 0.2, falseActivationRate: 0.05 }),
		);
		expect(d.nextStatus).toBe("active");
		expect(d.changed).toBe(false);
	});

	it("deprecated is terminal", () => {
		const d = decideSkillLifecycleTransition(
			signals({ status: "deprecated", validationPassed: true, deltaVsBaseline: 1, falseActivationRate: 0 }),
		);
		expect(d.nextStatus).toBe("deprecated");
		expect(d.changed).toBe(false);
	});

	it("honors custom thresholds", () => {
		// Require a delta > 0.5 and false-activation <= 0.02 to promote.
		const strict = { minDelta: 0.5, maxFalseActivationRate: 0.02 };
		expect(
			decideSkillLifecycleTransition(
				signals({ status: "quarantined", validationPassed: true, deltaVsBaseline: 0.4, falseActivationRate: 0 }),
				strict,
			).nextStatus,
		).toBe("deprecated"); // 0.4 ≤ 0.5 → non-positive under the strict bar
	});
});

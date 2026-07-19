import { describe, expect, it } from "vitest";
import { auditSkillFromPairedTrajectories } from "../../../src/core/procedural-skill-audit";

const ok = (turns?: number) => ({ succeeded: true, ...(turns !== undefined ? { turns } : {}) });
const fail = (turns?: number) => ({ succeeded: false, ...(turns !== undefined ? { turns } : {}) });

describe("F12.30 paired-trajectory skill audit", () => {
	it("promotes on a clear success-rate lift and retires on a clear drop", () => {
		const lift = auditSkillFromPairedTrajectories([ok(), ok(), ok()], [ok(), fail(), fail()]);
		expect(lift.action).toBe("promote");
		expect(lift.successDelta).toBeCloseTo(2 / 3, 5);
		const drop = auditSkillFromPairedTrajectories([fail(), fail(), ok()], [ok(), ok(), ok()]);
		expect(drop.action).toBe("retire");
	});

	it("promotes on equal success when the procedure saves >=20% effort", () => {
		const verdict = auditSkillFromPairedTrajectories([ok(4), ok(5), ok(3)], [ok(8), ok(9), ok(7)]);
		expect(verdict.action).toBe("promote");
		expect(verdict.costRatio).toBeLessThan(0.8);
		expect(verdict.reason).toContain("cost");
	});

	it("thin samples are unmeasured — never promote or retire on noise", () => {
		const verdict = auditSkillFromPairedTrajectories([ok(), ok()], [fail(), fail(), fail()]);
		expect(verdict.action).toBe("unmeasured");
		expect(verdict.successDelta).toBeNull();
	});

	it("indecisive signal asks for revision, with honest numbers in the reason", () => {
		const verdict = auditSkillFromPairedTrajectories([ok(5), ok(5), fail(5)], [ok(5), ok(5), fail(5)]);
		expect(verdict.action).toBe("revise");
		expect(verdict.successDelta).toBeCloseTo(0, 5);
	});
});

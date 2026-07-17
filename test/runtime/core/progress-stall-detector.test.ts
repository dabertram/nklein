import { describe, expect, it } from "vitest";
import { assessProgressStall, type TurnProgressRecord } from "../../../src/core/progress-stall-detector";

const turn = (overrides: Partial<TurnProgressRecord> = {}): TurnProgressRecord => ({
	filesWritten: [],
	focusStep: "step-1",
	ranVerification: false,
	...overrides,
});

describe("assessProgressStall (F12.22)", () => {
	it("flags four identical no-write turns as a stall regardless of read variety", () => {
		const verdict = assessProgressStall([turn(), turn(), turn(), turn()]);
		expect(verdict.stalled).toBe(true);
		expect(verdict.unchangedTurns).toBe(4);
		expect(verdict.reason).toContain("replan");
	});

	it("never alarms on steady writing to the same file (stable fingerprint WITH writes)", () => {
		const writing = turn({ filesWritten: ["src/a.ts"] });
		const verdict = assessProgressStall([writing, writing, writing, writing]);
		expect(verdict.stalled).toBe(false);
		expect(verdict.reason).toContain("steady work");
	});

	it("stays quiet while the fingerprint evolves or evidence is thin", () => {
		expect(assessProgressStall([turn(), turn()]).stalled).toBe(false);
		expect(assessProgressStall([turn(), turn({ focusStep: "step-2" }), turn(), turn()]).stalled).toBe(false);
		// A verification run changes the fingerprint — checking counts as progress.
		expect(assessProgressStall([turn(), turn(), turn(), turn({ ranVerification: true })]).stalled).toBe(false);
	});
});

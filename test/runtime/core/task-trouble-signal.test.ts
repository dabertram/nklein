import { describe, expect, it } from "vitest";
import { assessTaskTrouble } from "../../../src/core/task-trouble-signal";

const base = {
	stuckness: "progressing" as const,
	liveness: "active" as const,
	consecutiveNoProgress: 0,
	loopUncleared: false,
};

describe("assessTaskTrouble (§5.AA/§5.AG unified trouble signal)", () => {
	it("no trouble when everything is healthy", () => {
		expect(assessTaskTrouble(base)).toEqual({ trouble: false, kind: "none", reason: "" });
	});

	it("silent heartbeat outranks everything (most urgent — the run may be dead)", () => {
		const verdict = assessTaskTrouble({ ...base, liveness: "silent", stuckness: "hard_stuck", loopUncleared: true });
		expect(verdict.kind).toBe("silent");
	});

	it("hard_stuck outranks a no-progress streak", () => {
		const verdict = assessTaskTrouble({ ...base, stuckness: "hard_stuck", consecutiveNoProgress: 9 });
		expect(verdict.kind).toBe("hard_stuck");
	});

	it("an uncleared loop OR a no-progress streak at/above threshold ⇒ no_progress", () => {
		expect(assessTaskTrouble({ ...base, loopUncleared: true }).kind).toBe("no_progress");
		expect(assessTaskTrouble({ ...base, consecutiveNoProgress: 3 }).kind).toBe("no_progress");
		// Below the (default 3 / custom) threshold with no loop ⇒ still fine.
		expect(assessTaskTrouble({ ...base, consecutiveNoProgress: 2 }).trouble).toBe(false);
		expect(assessTaskTrouble({ ...base, consecutiveNoProgress: 2, noProgressThreshold: 2 }).kind).toBe("no_progress");
	});
});

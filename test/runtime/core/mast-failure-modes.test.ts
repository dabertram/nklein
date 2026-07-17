import { describe, expect, it } from "vitest";
import {
	classifyMastFailureMode,
	type MastAttemptSlice,
	mastRemedyHint,
	rollupMastDistribution,
} from "../../../src/core/mast-failure-modes";

const attempt = (over: Partial<MastAttemptSlice> = {}): MastAttemptSlice => ({
	outcome: "other_failure",
	qualityOk: null,
	salvage: null,
	toolCalls: [],
	...over,
});

describe("classifyMastFailureMode (F12.39)", () => {
	it("maps recorded outcome kinds to their witnessed MAST modes with evidence", () => {
		expect(classifyMastFailureMode(attempt({ outcome: "loop" })).mode).toBe("lost_history");
		expect(classifyMastFailureMode(attempt({ outcome: "narrated" })).mode).toBe("disobey_role");
		expect(classifyMastFailureMode(attempt({ outcome: "malformed" })).mode).toBe("disobey_spec");
		expect(classifyMastFailureMode(attempt({ outcome: "no_tool_call" })).mode).toBe("premature_termination");
		expect(classifyMastFailureMode(attempt({ outcome: "timeout" })).mode).toBe("environment");
		for (const slice of [attempt({ outcome: "loop" }), attempt({ outcome: "timeout" })]) {
			expect(classifyMastFailureMode(slice).evidence).toContain("outcome=");
		}
	});

	it("splits aborted by whether any work happened, and flags write-without-verify honestly", () => {
		expect(classifyMastFailureMode(attempt({ outcome: "aborted" })).mode).toBe("premature_termination");
		expect(classifyMastFailureMode(attempt({ outcome: "aborted", toolCalls: [{ name: "write_files" }] })).mode).toBe(
			"environment",
		);
		expect(classifyMastFailureMode(attempt({ toolCalls: [{ name: "edit_file" }] })).mode).toBe(
			"incomplete_verification",
		);
		expect(
			classifyMastFailureMode(attempt({ toolCalls: [{ name: "edit_file" }, { name: "run_command" }] })).mode,
		).toBe("unclassified");
		expect(classifyMastFailureMode(attempt({ qualityOk: false })).mode).toBe("disobey_spec");
	});

	it("rolls up per model, excludes successes, and names the dominant WITNESSED mode", () => {
		const rows = rollupMastDistribution([
			{ ...attempt({ outcome: "loop" }), modelId: "m1" },
			{ ...attempt({ outcome: "loop" }), modelId: "m1" },
			{ ...attempt({ outcome: "timeout" }), modelId: "m1" },
			{ ...attempt({ outcome: "success" }), modelId: "m1" },
			{ ...attempt({ outcome: "narrated" }), modelId: "m2" },
		]);
		expect(rows[0]).toMatchObject({ modelId: "m1", failedAttempts: 3, dominantMode: "lost_history" });
		expect(rows[0]?.byMode.environment).toBe(1);
		expect(rows[1]).toMatchObject({ modelId: "m2", dominantMode: "disobey_role" });
		// Environment-only failures yield no cognitive verdict.
		const infraOnly = rollupMastDistribution([{ ...attempt({ outcome: "timeout" }), modelId: "m3" }]);
		expect(infraOnly[0]?.dominantMode).toBeNull();
	});

	it("has a remedy hint for every mode", () => {
		for (const mode of [
			"disobey_spec",
			"disobey_role",
			"lost_history",
			"premature_termination",
			"incomplete_verification",
			"environment",
			"unclassified",
		] as const) {
			expect(mastRemedyHint(mode).length).toBeGreaterThan(10);
		}
	});
});

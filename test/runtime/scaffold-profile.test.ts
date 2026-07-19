import { describe, expect, it } from "vitest";
import { MINIMAL_SCAFFOLD, selectScaffoldProfile } from "../../src/core/scaffold-profile";

describe("scaffold profile selection (F12.14)", () => {
	it("keeps the standard scaffold when evidence is thin", () => {
		const selection = selectScaffoldProfile({ toolCallAttempts: 3, toolCallFailures: 3 });
		expect(selection.profile).toBe("standard");
		expect(selection.reason).toContain("too little evidence");
	});

	it("falls back to minimal when the rich surface demonstrably fails this model", () => {
		const selection = selectScaffoldProfile({ toolCallAttempts: 10, toolCallFailures: 7 });
		expect(selection.profile).toBe("minimal");
		expect(selection.reason).toContain("70% of 10 tool calls failed");
	});

	it("falls back to minimal on repeated no-tool-call stalls", () => {
		const selection = selectScaffoldProfile({
			toolCallAttempts: 0,
			toolCallFailures: 0,
			consecutiveNoToolCallSessions: 2,
		});
		expect(selection.profile).toBe("minimal");
		expect(selection.reason).toContain("needs FEWER tools");
	});

	it("keeps standard when the model drives tools acceptably", () => {
		const selection = selectScaffoldProfile({ toolCallAttempts: 20, toolCallFailures: 2 });
		expect(selection.profile).toBe("standard");
		expect(selection.reason).toContain("standard scaffold is working");
	});

	it("an operator override always wins over the heuristic", () => {
		expect(
			selectScaffoldProfile({ toolCallAttempts: 20, toolCallFailures: 0, forcedProfile: "minimal" }).profile,
		).toBe("minimal");
		expect(
			selectScaffoldProfile({ toolCallAttempts: 10, toolCallFailures: 9, forcedProfile: "standard" }).profile,
		).toBe("standard");
	});

	it("the minimal profile is bash-only with native tool-calling OFF", () => {
		expect(MINIMAL_SCAFFOLD.tools).toEqual(["run_command"]);
		expect(MINIMAL_SCAFFOLD.nativeToolCalling).toBe(false);
		expect(MINIMAL_SCAFFOLD.contract).toContain("ONE command per turn");
		expect(MINIMAL_SCAFFOLD.contract).toContain("Do not describe what you would do");
	});
});

import { describe, expect, it } from "vitest";

import type { ChatAgentStep } from "../../../src/chat/chat-agent-loop";
import {
	createAutonomousControlTools,
	interpretAutonomousTurnOutcome,
} from "../../../src/chat/chat-autonomous-control-tools";

function step(name: string): ChatAgentStep {
	return { toolCall: { id: `c-${name}`, name, arguments: {} }, result: { callId: `c-${name}`, content: "ok" } };
}

describe("createAutonomousControlTools", () => {
	it("captures a user question and a completion summary into the shared signals", async () => {
		const control = createAutonomousControlTools();
		const ask = control.tools.find((tool) => tool.name === "request_user_input");
		const done = control.tools.find((tool) => tool.name === "declare_goal_complete");
		await ask?.run({ question: "  Which auth provider?  " });
		await done?.run({ summary: "Shipped the feature." });
		expect(control.signals.userQuestion).toBe("Which auth provider?");
		expect(control.signals.goalCompleteSummary).toBe("Shipped the feature.");
		expect(control.controlToolNames.has("request_user_input")).toBe(true);
		// Both tools are pure signals → the always-allowed action kind.
		expect(control.tools.every((tool) => tool.actionKind === "sandbox_read")).toBe(true);
		// A definition is offered to the model for each tool.
		expect(control.definitions.map((definition) => definition.name).sort()).toEqual([
			"declare_goal_complete",
			"request_user_input",
		]);
	});

	it("rejects an empty question without setting the signal", async () => {
		const control = createAutonomousControlTools();
		const ask = control.tools.find((tool) => tool.name === "request_user_input");
		const message = await ask?.run({ question: "   " });
		expect(message).toMatch(/non-empty `question`/);
		expect(control.signals.userQuestion).toBeNull();
	});

	it("defaults an empty completion summary rather than dropping the signal", async () => {
		const control = createAutonomousControlTools();
		const done = control.tools.find((tool) => tool.name === "declare_goal_complete");
		await done?.run({});
		expect(control.signals.goalCompleteSummary).toBe("Goal complete.");
	});
});

describe("interpretAutonomousTurnOutcome", () => {
	const names = new Set(["request_user_input", "declare_goal_complete"]);

	it("maps a captured question to needs_user", () => {
		const outcome = interpretAutonomousTurnOutcome(
			{ finalText: "...", steps: [step("read_board"), step("request_user_input")] },
			{ userQuestion: "Which DB?", goalCompleteSummary: null },
			names,
		);
		expect(outcome.status).toBe("needs_user");
		expect(outcome.text).toBe("Which DB?");
		expect(outcome.madeToolProgress).toBe(true); // read_board is a non-control step
	});

	it("prefers needs_user over goal_complete when both fired", () => {
		const outcome = interpretAutonomousTurnOutcome(
			{ finalText: "...", steps: [] },
			{ userQuestion: "wait", goalCompleteSummary: "done" },
			names,
		);
		expect(outcome.status).toBe("needs_user");
	});

	it("maps a captured completion to goal_complete", () => {
		const outcome = interpretAutonomousTurnOutcome(
			{ finalText: "ignored", steps: [step("update_focus_chain")] },
			{ userQuestion: null, goalCompleteSummary: "All steps done." },
			names,
		);
		expect(outcome.status).toBe("goal_complete");
		expect(outcome.text).toBe("All steps done.");
	});

	it("maps no signal to progressed, counting only non-control steps as tool progress", () => {
		const progressed = interpretAutonomousTurnOutcome(
			{ finalText: "did work", steps: [step("apply_patch")] },
			{ userQuestion: null, goalCompleteSummary: null },
			names,
		);
		expect(progressed.status).toBe("progressed");
		expect(progressed.text).toBe("did work");
		expect(progressed.madeToolProgress).toBe(true);

		// A turn that only signalled / spun on control tools made NO real progress (trips the stall guard).
		const noProgress = interpretAutonomousTurnOutcome(
			{ finalText: "just talked", steps: [step("request_user_input")] },
			{ userQuestion: null, goalCompleteSummary: null },
			names,
		);
		expect(noProgress.status).toBe("progressed");
		expect(noProgress.madeToolProgress).toBe(false);
	});
});

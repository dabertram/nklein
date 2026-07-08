import { describe, expect, it } from "vitest";
import { buildAcceptanceCompletionGate, extractAcceptanceCommand } from "../../../src/chat/chat-acceptance-completion";
import type { ChatAgentStep } from "../../../src/chat/chat-agent-loop";

function step(name: string, command: string | undefined, resultContent: string): ChatAgentStep {
	return {
		toolCall: { id: "c1", name, arguments: command === undefined ? {} : { command } },
		result: { callId: "c1", content: resultContent },
	};
}

describe("extractAcceptanceCommand (the card's `Acceptance check:` line)", () => {
	it("pulls the command from a multi-line card prompt and returns null when absent", () => {
		expect(extractAcceptanceCommand("Build the widget.\nAcceptance check: npm test\nKeep it small.")).toBe(
			"npm test",
		);
		expect(extractAcceptanceCommand("Just explain merging.")).toBeNull();
		expect(extractAcceptanceCommand("Acceptance check:    ")).toBeNull();
	});
});

describe("buildAcceptanceCompletionGate (§5.AA evidence-gate: acceptance run beats model self-report)", () => {
	const gate = buildAcceptanceCompletionGate("npm test");

	it("is complete only when run_command actually ran the acceptance command with exit 0", () => {
		expect(gate([step("run_command", "npm test", "Command exited with code 0.\nstdout:\nok")])).toBe(true);
		// Wrapped invocation still counts (normalized substring).
		expect(gate([step("run_command", "cd app && npm  test", "Command exited with code 0.")])).toBe(true);
	});

	it("rejects a failed run, a different command, a non-command tool, and no steps at all", () => {
		expect(gate([step("run_command", "npm test", "Command exited with code 1.\nstderr:\nfail")])).toBe(false);
		expect(gate([step("run_command", "npm run build", "Command exited with code 0.")])).toBe(false);
		expect(gate([step("read_file", undefined, "file contents")])).toBe(false);
		expect(gate([])).toBe(false);
	});
});

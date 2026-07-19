import { describe, expect, it } from "vitest";
import { buildStallReplanMessage, STALL_REPLAN_MESSAGE_KIND } from "../../../src/nklein-agent/stall-replan-message";

describe("stall replan message (F12.22 enforcing half)", () => {
	it("builds the fenced replan demand with the reason and current step", () => {
		const message = buildStallReplanMessage({
			reason: "4 identical no-write calls",
			focusStep: "wire the parser",
			now: 1_000,
		});
		const text = message.content[0].text;
		expect(message.role).toBe("user");
		expect(message.metadata.kind).toBe(STALL_REPLAN_MESSAGE_KIND);
		expect(message.id).toBe("kanban-stall-replan-1000");
		expect(text).toContain("4 identical no-write calls");
		expect(text).toContain("Current step on your plan: wire the parser");
		expect(text).toContain("update_focus_chain");
		expect(text.startsWith("<system-reminder>")).toBe(true);
		expect(text.endsWith("</system-reminder>")).toBe(true);
	});

	it("omits the step line when no focus step is known", () => {
		const text = buildStallReplanMessage({ reason: "circling", focusStep: null, now: 1 }).content[0].text;
		expect(text).not.toContain("Current step on your plan");
		expect(text).toContain("STOP repeating the current approach.");
	});
});

// F12.24 wire helper — offer-ordering by trust (drop-withhold, demote-to-tail, never-strand, no-op identity).
import { createToolTrustState, orderOfferedToolsByTrust, recordToolOutcome } from "../../../src/core/tool-trust-decay";

describe("offered-tool ordering by trust (F12.24 activation)", () => {
	const tools = [{ name: "edit_file" }, { name: "read_files" }, { name: "run_command" }];

	it("returns the same array when every tool is trusted (cheap no-op detection)", () => {
		expect(orderOfferedToolsByTrust(createToolTrustState(), tools)).toBe(tools);
	});

	it("sinks a demoted tool to the tail and withholds a dropped one, never stranding the model", () => {
		const state = createToolTrustState();
		for (let i = 0; i < 3; i += 1) {
			recordToolOutcome(state, "edit_file", false);
		}
		expect(orderOfferedToolsByTrust(state, tools).map((tool) => tool.name)).toEqual([
			"read_files",
			"run_command",
			"edit_file",
		]);
		for (let i = 0; i < 2; i += 1) {
			recordToolOutcome(state, "edit_file", false);
		}
		expect(orderOfferedToolsByTrust(state, tools).map((tool) => tool.name)).toEqual(["read_files", "run_command"]);
		const onlyTool = [{ name: "edit_file" }];
		expect(orderOfferedToolsByTrust(state, onlyTool)).toBe(onlyTool);
	});
});

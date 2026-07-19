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

import { describe, expect, it } from "vitest";
import { buildReanchorReminder, decideReanchor } from "../../../src/core/instruction-reanchor";

describe("decideReanchor (F12.21)", () => {
	it("fires on a detected loop regardless of turn count", () => {
		const decision = decideReanchor({ turnsSinceAnchor: 1, toolErrorJustHappened: false, loopDetected: true });
		expect(decision).toMatchObject({ fire: true, trigger: "loop_detected" });
	});

	it("fires on a tool error only once the anchor is stale (≥3 turns), and on the periodic interval", () => {
		expect(decideReanchor({ turnsSinceAnchor: 2, toolErrorJustHappened: true, loopDetected: false }).fire).toBe(
			false,
		);
		expect(decideReanchor({ turnsSinceAnchor: 3, toolErrorJustHappened: true, loopDetected: false }).trigger).toBe(
			"tool_error",
		);
		expect(decideReanchor({ turnsSinceAnchor: 12, toolErrorJustHappened: false, loopDetected: false }).trigger).toBe(
			"turn_interval",
		);
		expect(decideReanchor({ turnsSinceAnchor: 11, toolErrorJustHappened: false, loopDetected: false }).fire).toBe(
			false,
		);
	});
});

describe("buildReanchorReminder (F12.21)", () => {
	it("renders the compact tail anchor with step + criteria + trigger-specific guidance", () => {
		const reminder = buildReanchorReminder({
			acceptanceCriteria: "npm test passes",
			currentFocusStep: "Wire the parser",
			trigger: "loop_detected",
		});
		expect(reminder).toContain("Current step: Wire the parser");
		expect(reminder).toContain("Done means: npm test passes");
		expect(reminder).toContain("SMALLEST next action");
	});

	it("omits absent fields instead of rendering empty labels", () => {
		const reminder = buildReanchorReminder({
			acceptanceCriteria: null,
			currentFocusStep: null,
			trigger: "turn_interval",
		});
		expect(reminder).not.toContain("Current step:");
		expect(reminder).not.toContain("Done means:");
	});
});

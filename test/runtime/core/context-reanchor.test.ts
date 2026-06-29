import { describe, expect, it } from "vitest";
import { buildContextReanchor, shouldReanchor } from "../../../src/core/context-reanchor";

describe("buildContextReanchor", () => {
	it("emits a full block with all fields when all are provided", () => {
		const block = buildContextReanchor({
			goal: "Implement feature X",
			currentStep: "Write the failing test first",
			cardTitle: "Feature X card",
			recentToolNames: ["read_file", "edit_file", "run_tests"],
		});
		expect(block).toBe(
			[
				"<reanchor>",
				"GOAL: Implement feature X",
				"CARD: Feature X card",
				"CURRENT STEP: Write the failing test first",
				"RECENT TOOLS: read_file, edit_file, run_tests",
				"</reanchor>",
			].join("\n"),
		);
	});

	it("omits optional fields when they are null or undefined", () => {
		const block = buildContextReanchor({
			goal: "Fix the regression",
			currentStep: null,
			cardTitle: null,
		});
		expect(block).toBe("<reanchor>\nGOAL: Fix the regression\n</reanchor>");
	});

	it("omits optional fields when they are empty/whitespace strings", () => {
		const block = buildContextReanchor({
			goal: "Refactor auth module",
			currentStep: "   ",
			cardTitle: "",
			recentToolNames: [],
		});
		expect(block).toBe("<reanchor>\nGOAL: Refactor auth module\n</reanchor>");
	});

	it("includes card title but omits current step when only card title is given", () => {
		const block = buildContextReanchor({
			goal: "Improve test coverage",
			cardTitle: "Coverage card",
		});
		expect(block).toBe(
			["<reanchor>", "GOAL: Improve test coverage", "CARD: Coverage card", "</reanchor>"].join("\n"),
		);
	});

	it("trims whitespace from goal and included optional fields", () => {
		const block = buildContextReanchor({
			goal: "  Migrate database schema  ",
			currentStep: "  Run migrations  ",
			recentToolNames: ["  ", "bash", "  read  "],
		});
		// Blank tool names are filtered; goal and step are trimmed; "  read  " tool is kept as-is (tool name trim is
		// only applied when checking emptiness, not when rendering — match the filter logic in the implementation).
		expect(block).toContain("GOAL: Migrate database schema");
		expect(block).toContain("CURRENT STEP: Run migrations");
		expect(block).toContain("RECENT TOOLS:");
		expect(block).toContain("bash");
		// The blank-only tool name is filtered out
		expect(block).not.toMatch(/RECENT TOOLS:.*,\s*,/);
	});
});

describe("shouldReanchor", () => {
	it("never fires on turn 0", () => {
		expect(shouldReanchor({ turnCount: 0, lastReanchorTurn: null, everyNTurns: 1 })).toBe(false);
		expect(shouldReanchor({ turnCount: 0, lastReanchorTurn: null, everyNTurns: 5 })).toBe(false);
	});

	it("fires on the first eligible turn when no prior re-anchor (lastReanchorTurn=null)", () => {
		// everyNTurns=5: should fire when turnCount >= 5 (gap from -Infinity treated as always >= everyNTurns once > 0)
		expect(shouldReanchor({ turnCount: 1, lastReanchorTurn: null, everyNTurns: 1 })).toBe(true);
		expect(shouldReanchor({ turnCount: 4, lastReanchorTurn: null, everyNTurns: 5 })).toBe(true);
		expect(shouldReanchor({ turnCount: 10, lastReanchorTurn: null, everyNTurns: 5 })).toBe(true);
	});

	it("respects the everyNTurns cadence after a prior re-anchor", () => {
		// lastReanchorTurn=10, everyNTurns=5: next fire at turnCount=15
		expect(shouldReanchor({ turnCount: 14, lastReanchorTurn: 10, everyNTurns: 5 })).toBe(false);
		expect(shouldReanchor({ turnCount: 15, lastReanchorTurn: 10, everyNTurns: 5 })).toBe(true);
		expect(shouldReanchor({ turnCount: 20, lastReanchorTurn: 10, everyNTurns: 5 })).toBe(true);
	});

	it("clamps everyNTurns to 1 to prevent every-turn injection from a zero value", () => {
		// everyNTurns=0 is clamped to 1; so turn 1 with lastReanchor=0 gives gap=1>=1=true
		expect(shouldReanchor({ turnCount: 1, lastReanchorTurn: 0, everyNTurns: 0 })).toBe(true);
		// And turn 1 after a reanchor at turn 1 gives gap=0 < 1 = false
		expect(shouldReanchor({ turnCount: 1, lastReanchorTurn: 1, everyNTurns: 0 })).toBe(false);
	});

	it("handles the boundary: exactly everyNTurns elapsed fires, one less does not", () => {
		// gap = 9 - 5 = 4; everyNTurns=4 → exactly at boundary → fires
		expect(shouldReanchor({ turnCount: 9, lastReanchorTurn: 5, everyNTurns: 4 })).toBe(true);
		// gap = 9 - 5 = 4; everyNTurns=5 → one short → does not fire
		expect(shouldReanchor({ turnCount: 9, lastReanchorTurn: 5, everyNTurns: 5 })).toBe(false);
	});
});

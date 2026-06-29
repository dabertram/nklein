import { describe, expect, it } from "vitest";
import type { ToolCard } from "../../../src/core/tool-card";
import {
	interpretPhaseOnePick,
	isActionableSingleTool,
	type PhaseOneDecision,
} from "../../../src/core/two-phase-tool-pick";

// Minimal card fixtures — only `name` matters for interpretation.
const CARDS: readonly ToolCard[] = [
	{ name: "read_file", purpose: "Read file contents", useWhen: "Before editing" },
	{ name: "write_file", purpose: "Write to a file", useWhen: "To create or modify a file" },
	{ name: "list_models", purpose: "List loaded models", useWhen: "When you need to see available models" },
];

describe("interpretPhaseOnePick", () => {
	it('maps "none" → { kind: "none" }', () => {
		expect(interpretPhaseOnePick("none", CARDS)).toEqual({ kind: "none" });
	});

	it('maps empty string → { kind: "none" }', () => {
		expect(interpretPhaseOnePick("", CARDS)).toEqual({ kind: "none" });
	});

	it('maps whitespace-only → { kind: "none" }', () => {
		expect(interpretPhaseOnePick("   ", CARDS)).toEqual({ kind: "none" });
	});

	it('maps "no tool" (with surrounding whitespace) → { kind: "none" }', () => {
		expect(interpretPhaseOnePick("  no tool  ", CARDS)).toEqual({ kind: "none" });
	});

	it('maps "plan_needed" → { kind: "plan_needed" }', () => {
		expect(interpretPhaseOnePick("plan_needed", CARDS)).toEqual({ kind: "plan_needed" });
	});

	it('maps "multiple" → { kind: "plan_needed" }', () => {
		expect(interpretPhaseOnePick("multiple", CARDS)).toEqual({ kind: "plan_needed" });
	});

	it("maps an exact card name → { kind: 'one_tool', tool: <canonical name> }", () => {
		expect(interpretPhaseOnePick("read_file", CARDS)).toEqual({ kind: "one_tool", tool: "read_file" });
	});

	it("matches card name case-insensitively and returns the canonical casing", () => {
		expect(interpretPhaseOnePick("READ_FILE", CARDS)).toEqual({ kind: "one_tool", tool: "read_file" });
		expect(interpretPhaseOnePick("Write_File", CARDS)).toEqual({ kind: "one_tool", tool: "write_file" });
	});

	it("maps an unknown / hallucinated tool name → { kind: 'plan_needed' }", () => {
		expect(interpretPhaseOnePick("delete_everything", CARDS)).toEqual({ kind: "plan_needed" });
	});

	it("maps a partial card-name match (not exact) → { kind: 'plan_needed' }", () => {
		// "read" is not a valid card name even though "read_file" exists.
		expect(interpretPhaseOnePick("read", CARDS)).toEqual({ kind: "plan_needed" });
	});
});

describe("isActionableSingleTool", () => {
	it("returns true and narrows type for a one_tool decision", () => {
		const decision: PhaseOneDecision = { kind: "one_tool", tool: "read_file" };
		expect(isActionableSingleTool(decision)).toBe(true);
		if (isActionableSingleTool(decision)) {
			// TypeScript should accept decision.tool here (compile-time check encoded as a runtime assertion).
			expect(decision.tool).toBe("read_file");
		}
	});

	it("returns false for a none decision", () => {
		expect(isActionableSingleTool({ kind: "none" })).toBe(false);
	});

	it("returns false for a plan_needed decision", () => {
		expect(isActionableSingleTool({ kind: "plan_needed" })).toBe(false);
	});
});

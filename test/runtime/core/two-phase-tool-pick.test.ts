import { describe, expect, it } from "vitest";
import type { ToolCard } from "../../../src/core/tool-card";
import {
	buildPhaseOneToolMenu,
	interpretPhaseOnePick,
	interpretPhaseOneResponse,
	isActionableSingleTool,
	PHASE_ONE_NONE_ANSWER,
	PHASE_ONE_PLAN_ANSWER,
	type PhaseOneDecision,
	selectRevealedToolSchema,
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

describe("buildPhaseOneToolMenu", () => {
	it("lists every offered tool's name in the menu", () => {
		const menu = buildPhaseOneToolMenu(CARDS);
		for (const card of CARDS) {
			expect(menu).toContain(card.name);
		}
	});

	it("teaches the canonical none / plan answers the parser accepts", () => {
		const menu = buildPhaseOneToolMenu(CARDS);
		expect(menu).toContain(`"${PHASE_ONE_NONE_ANSWER}"`);
		expect(menu).toContain(`"${PHASE_ONE_PLAN_ANSWER}"`);
	});

	// Anti-drift invariant: the two canonical answers the MENU instructs must be answers the PARSER accepts, or the two
	// halves of the protocol would silently disagree. Pins prompt vocabulary ⊆ parser vocabulary.
	it("round-trips: the canonical answers it teaches parse to none / plan_needed", () => {
		expect(interpretPhaseOnePick(PHASE_ONE_NONE_ANSWER, CARDS)).toEqual({ kind: "none" });
		expect(interpretPhaseOnePick(PHASE_ONE_PLAN_ANSWER, CARDS)).toEqual({ kind: "plan_needed" });
	});

	// The menu offers exactly the tool names the parser recognizes — every listed tool, fed back, is an actionable pick.
	it("round-trips: every tool it offers is a valid one_tool pick", () => {
		buildPhaseOneToolMenu(CARDS); // menu is built from the same cards the parser is given
		for (const card of CARDS) {
			expect(interpretPhaseOnePick(card.name, CARDS)).toEqual({ kind: "one_tool", tool: card.name });
		}
	});

	it("emits a coherent menu with no tools (only none / plan apply)", () => {
		const menu = buildPhaseOneToolMenu([]);
		expect(menu).toContain("(no tools available)");
		expect(menu).toContain(`"${PHASE_ONE_NONE_ANSWER}"`);
		expect(menu).toContain(`"${PHASE_ONE_PLAN_ANSWER}"`);
	});
});

describe("selectRevealedToolSchema", () => {
	// Distinct sentinel schema objects; identity checks prove ONLY the picked one is revealed.
	const readSchema = { tool: "read_file", params: ["path"] };
	const writeSchema = { tool: "write_file", params: ["path", "content"] };
	const schemas = new Map<string, typeof readSchema>([
		["read_file", readSchema],
		["write_file", writeSchema],
	]);

	it("reveals ONLY the picked tool's schema for a one_tool decision", () => {
		expect(selectRevealedToolSchema({ kind: "one_tool", tool: "read_file" }, schemas)).toBe(readSchema);
		expect(selectRevealedToolSchema({ kind: "one_tool", tool: "write_file" }, schemas)).toBe(writeSchema);
	});

	it("returns null for a one_tool pick whose schema is absent (escalate, don't invent)", () => {
		expect(selectRevealedToolSchema({ kind: "one_tool", tool: "delete_all" }, schemas)).toBeNull();
	});

	it("returns null for none and plan_needed (no single schema to reveal)", () => {
		expect(selectRevealedToolSchema({ kind: "none" }, schemas)).toBeNull();
		expect(selectRevealedToolSchema({ kind: "plan_needed" }, schemas)).toBeNull();
	});

	// End-to-end pure two-phase: parse a raw pick → reveal exactly that tool's schema, nothing else.
	it("composes with interpretPhaseOnePick end-to-end (pick → reveal)", () => {
		const decision = interpretPhaseOnePick("write_file", CARDS);
		expect(selectRevealedToolSchema(decision, schemas)).toBe(writeSchema);
	});
});

describe("interpretPhaseOneResponse (truncation-aware)", () => {
	// The finding that motivated this: qwen3.5-9b spends ~400 tokens reasoning before the pick, so a small budget
	// yields empty content + finish_reason "length" — a truncated NON-answer, not a decision to use no tool.
	it("treats a truncated empty answer (finish_reason 'length') as plan_needed, not none", () => {
		expect(interpretPhaseOneResponse({ content: "", finishReason: "length" }, CARDS)).toEqual({
			kind: "plan_needed",
		});
		expect(interpretPhaseOneResponse({ content: "   ", finishReason: "length" }, CARDS)).toEqual({
			kind: "plan_needed",
		});
	});

	it("treats a genuinely blank answer that finished normally as none", () => {
		expect(interpretPhaseOneResponse({ content: "", finishReason: "stop" }, CARDS)).toEqual({ kind: "none" });
		expect(interpretPhaseOneResponse({ content: "none" }, CARDS)).toEqual({ kind: "none" });
	});

	it("delegates a non-empty answer to interpretPhaseOnePick (trimming leading reasoning-model whitespace)", () => {
		// Real observed shape: the model emitted '\n\nread_files'.
		expect(interpretPhaseOneResponse({ content: "\n\nread_file", finishReason: "stop" }, CARDS)).toEqual({
			kind: "one_tool",
			tool: "read_file",
		});
		// A truncated-but-named pick is still a usable exact name (only EMPTY truncation escalates).
		expect(interpretPhaseOneResponse({ content: "write_file", finishReason: "length" }, CARDS)).toEqual({
			kind: "one_tool",
			tool: "write_file",
		});
	});
});

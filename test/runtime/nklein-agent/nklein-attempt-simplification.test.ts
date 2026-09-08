import { describe, expect, it } from "vitest";
import { selectToolsForAttempt, stripNKleinScaffolding } from "../../../src/nklein-agent/nklein-attempt-simplification";

const TOOLS = [
	{ name: "read_file" },
	{ name: "list_dir" },
	{ name: "get_board" },
	{ name: "update_focus_chain" },
	{ name: "create_card" },
	{ name: "run_command" },
];

describe("selectToolsForAttempt", () => {
	it("returns the full set unchanged at level 0", () => {
		const result = selectToolsForAttempt(TOOLS, "create a card titled X with create_card", 0);
		expect(result.reduced).toBe(false);
		expect(result.tools).toHaveLength(6);
	});

	it("narrows to the single referenced tool at level 1 (grounded: phi works with 1 tool)", () => {
		const result = selectToolsForAttempt(TOOLS, 'Use create_card to make a card titled "X".', 1);
		expect(result.reduced).toBe(true);
		expect(result.matchedNames).toEqual(["create_card"]);
		expect(result.tools).toEqual([{ name: "create_card" }]);
	});

	it("keeps the referenced tools in instruction-mention order at level 1", () => {
		const result = selectToolsForAttempt(TOOLS, "First run_command `ls`, then create_card for the result.", 1);
		expect(result.matchedNames).toEqual(["run_command", "create_card"]);
		expect(result.reduced).toBe(true);
	});

	it("caps to the single first-referenced tool at level 2", () => {
		const result = selectToolsForAttempt(TOOLS, "First run_command `ls`, then create_card for the result.", 2);
		expect(result.matchedNames).toEqual(["run_command"]);
		expect(result.tools).toEqual([{ name: "run_command" }]);
	});

	it("leaves the set intact when the instruction references no tool by name (nothing safe to anchor on)", () => {
		const result = selectToolsForAttempt(TOOLS, "Please help me organize my work and make progress.", 2);
		expect(result.reduced).toBe(false);
		expect(result.tools).toHaveLength(6);
	});

	it("is a no-op when there is at most one tool", () => {
		expect(selectToolsForAttempt([{ name: "create_card" }], "do nothing relevant", 2).reduced).toBe(false);
		expect(selectToolsForAttempt([], "x", 2).tools).toEqual([]);
	});

	it("matches tool names case-insensitively", () => {
		const result = selectToolsForAttempt(TOOLS, "use CREATE_CARD now", 1);
		expect(result.matchedNames).toEqual(["create_card"]);
	});

	it("anchors on natural language via the distinctive last word (no underscore: 'make a card')", () => {
		const result = selectToolsForAttempt(TOOLS, "Please make a card titled X for me.", 1);
		expect(result.matchedNames).toEqual(["create_card"]);
		expect(result.reduced).toBe(true);
	});

	it("anchors 'run the command' onto run_command via its last word", () => {
		const result = selectToolsForAttempt(TOOLS, "Now run the command for me, please.", 1);
		expect(result.matchedNames).toEqual(["run_command"]);
	});
});

describe("the anchor reads the task, not !Klein's own scaffolding", () => {
	// Live 2026-09-08 (HITL rig, card a00 of 42_analysis_unchecked_error_audit): a card with nothing left to do
	// oscillated for 16 turns and never finished. The model ended each turn cleanly with no tool call — correct for
	// an already-satisfied card — and each time this ladder narrowed the offered set to exactly `read_files` and
	// forced another read. `read_files` was "mentioned" only by !Klein's own focus brief.
	const FOCUS_BRIEF_TURN = [
		"[!Klein context focus brief]",
		"Known existing paths observed in this session:",
		"- /findings.test.js",
		"read_files coverage ledger:",
		"- specification.md, input/order-service.mjs (latest raw)",
		"[/!Klein context focus brief]",
		"",
		"[!Klein repo map: compact codebase orientation]",
		"test/findings.test.js:70 const deliverable refs=7",
		"",
		"The acceptance command already passes. Confirm and finish.",
	].join("\n");

	const TOOLS = [{ name: "read_files" }, { name: "run_commands" }, { name: "write_files" }];

	it("does not narrow when only !Klein's scaffolding names a tool", () => {
		for (const level of [1, 2]) {
			const selection = selectToolsForAttempt(TOOLS, FOCUS_BRIEF_TURN, level);
			expect(selection.reduced, `level ${level} narrowed on scaffolding alone`).toBe(false);
			expect(selection.tools).toHaveLength(TOOLS.length);
		}
	});

	it("still anchors on a tool the TASK itself names", () => {
		const withTask = `${FOCUS_BRIEF_TURN}\n\nRe-run the acceptance check with run_commands, then finish.`;
		expect(selectToolsForAttempt(TOOLS, withTask, 2).matchedNames).toEqual(["run_commands"]);
	});

	it("drops the retry ladder's own 'already attempted' block, which quotes the uncalled tool", () => {
		const ladderNote = [
			"Already attempted this task (do NOT repeat these — try something different):",
			"1. tried reduced_tool_set → no_tool_call (the model stopped without calling read_files)",
			"",
			"Finish the card.",
		].join("\n");
		expect(selectToolsForAttempt(TOOLS, ladderNote, 2).reduced).toBe(false);
	});

	it("leaves ordinary prose untouched, scaffolding markers or not", () => {
		expect(stripNKleinScaffolding("Read the spec, then run_commands.")).toBe("Read the spec, then run_commands.");
	});
});

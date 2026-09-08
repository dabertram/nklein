import { describe, expect, it } from "vitest";
import {
	selectToolsForAttempt,
	stripNKleinScaffolding,
	TURN_EXIT_TOOL_NAMES,
} from "../../../src/nklein-agent/nklein-attempt-simplification";

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

/**
 * P1.RESPONDERLEADS lead (a), the structural half: card a00 (2026-09-08) was narrowed to `read_files` alone while
 * its completion gate required that `npm test` had actually RUN. No amount of model effort can end a turn whose
 * only offered tool cannot produce the required evidence, so the card spun to the iteration cap. Narrowing the ask
 * is fine; narrowing away the exit is not.
 */
describe("selectToolsForAttempt — alwaysKeep", () => {
	const TOOLS = [{ name: "read_files" }, { name: "run_command" }, { name: "edit_file" }];

	it("keeps the gate's tool even when the anchor caps the set at one", () => {
		const anchored = selectToolsForAttempt(TOOLS, "read_files the spec first", 2);
		expect(anchored.tools.map((tool) => tool.name)).toEqual(["read_files"]);

		const rescued = selectToolsForAttempt(TOOLS, "read_files the spec first", 2, { alwaysKeep: ["run_command"] });
		expect(rescued.tools.map((tool) => tool.name)).toEqual(["read_files", "run_command"]);
		// Still a narrowing (edit_file is gone), so the ladder keeps its cheaper-ask property.
		expect(rescued.reduced).toBe(true);
		// The anchor report is unchanged: `run_command` was rescued, not matched.
		expect(rescued.matchedNames).toEqual(["read_files"]);
	});

	it("does not duplicate a kept tool the anchor already selected", () => {
		const selection = selectToolsForAttempt(TOOLS, "run_command the acceptance check", 2, {
			alwaysKeep: ["run_command"],
		});
		expect(selection.tools.map((tool) => tool.name)).toEqual(["run_command"]);
	});

	it("ignores a kept name that was never offered, and changes nothing without the option", () => {
		const selection = selectToolsForAttempt(TOOLS, "read_files the spec", 2, { alwaysKeep: ["submit_review"] });
		expect(selection.tools.map((tool) => tool.name)).toEqual(["read_files"]);
		expect(selectToolsForAttempt(TOOLS, "read_files the spec", 2).tools.map((tool) => tool.name)).toEqual([
			"read_files",
		]);
	});
});

/**
 * The narrowed turn must still be able to END. Live 2026-09-08: a request offered only `list_files`, so the
 * model's attempt to record why it was declining came back as "Model tried to call unavailable tool
 * 'update_focus_chain'. Available tools: list_files." Nineteen of that shift's twenty-five requests were
 * regenerations of branches stuck exactly this way.
 */
describe("selectToolsForAttempt — the turn's exits survive narrowing", () => {
	const FULL = [
		{ name: "read_files" },
		{ name: "list_files" },
		{ name: "write_file" },
		{ name: "run_command" },
		{ name: "decompose_project" },
		{ name: "begin_implementation" },
		{ name: "submit_review" },
		{ name: "update_focus_chain" },
	];

	it("keeps every control-plane tool even at the most aggressive level", () => {
		const selection = selectToolsForAttempt(FULL, "list_files in the workspace first", 2, {
			alwaysKeep: TURN_EXIT_TOOL_NAMES,
		});
		const names = selection.tools.map((tool) => tool.name);
		expect(names[0]).toBe("list_files");
		for (const exit of TURN_EXIT_TOOL_NAMES) {
			expect(names).toContain(exit);
		}
		// Still a narrowing: the work tools the instruction did not name are gone.
		expect(names).not.toContain("write_file");
		expect(names).not.toContain("read_files");
		expect(selection.reduced).toBe(true);
	});

	it("names only the anchored tool as matched — the exits are rescued, not chosen", () => {
		const selection = selectToolsForAttempt(FULL, "list_files in the workspace first", 2, {
			alwaysKeep: TURN_EXIT_TOOL_NAMES,
		});
		expect(selection.matchedNames).toEqual(["list_files"]);
	});
});

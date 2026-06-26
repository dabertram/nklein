import { describe, expect, it } from "vitest";
import { selectToolsForAttempt } from "../../../src/nklein-agent/nklein-attempt-simplification";

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

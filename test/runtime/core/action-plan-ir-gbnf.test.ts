import { describe, expect, it } from "vitest";
import { actionPlanIrToGbnf, collectGbnfRuleReferences } from "../../../src/core/action-plan-ir-gbnf";

describe("actionPlanIrToGbnf", () => {
	it("emits a grammar with a root rule and the action-plan structure", () => {
		const grammar = actionPlanIrToGbnf();
		expect(grammar).toMatch(/^root ::=/m);
		// The root must reference the step-array, and step must carry id/tool/args.
		expect(grammar).toContain("step-array");
		expect(grammar).toContain('"\\"id\\""');
		expect(grammar).toContain('"\\"tool\\""');
		expect(grammar).toContain('"\\"args\\""');
		expect(grammar).toContain('"\\"dependsOn\\""');
		// Trailing newline so it concatenates cleanly.
		expect(grammar.endsWith("\n")).toBe(true);
	});

	it("leaves `tool` as any string when no tool names are given", () => {
		const grammar = actionPlanIrToGbnf();
		expect(grammar).toMatch(/^tool ::= string$/m);
	});

	it("narrows `tool` to a closed alternation of the provided names", () => {
		const grammar = actionPlanIrToGbnf({ toolNames: ["read_file", "create_card"] });
		const toolLine = grammar.split("\n").find((l) => l.startsWith("tool ::="));
		expect(toolLine).toBe('tool ::= "\\"read_file\\"" | "\\"create_card\\""');
		// It must NOT fall back to the open `string` rule.
		expect(toolLine).not.toContain("string");
	});

	it("de-duplicates tool names while preserving first-seen order", () => {
		const grammar = actionPlanIrToGbnf({ toolNames: ["b", "a", "b", "a"] });
		const toolLine = grammar.split("\n").find((l) => l.startsWith("tool ::="));
		expect(toolLine).toBe('tool ::= "\\"b\\"" | "\\"a\\""');
	});

	it("rejects an unsafe tool name that would corrupt the grammar", () => {
		expect(() => actionPlanIrToGbnf({ toolNames: ['bad"name'] })).toThrow(/unsafe tool name/);
		expect(() => actionPlanIrToGbnf({ toolNames: ["ok", "with space"] })).toThrow(/unsafe tool name/);
		expect(() => actionPlanIrToGbnf({ toolNames: ["back\\slash"] })).toThrow(/unsafe tool name/);
	});

	it("accepts realistic tool identifiers (letters, digits, _ . : -)", () => {
		expect(() => actionPlanIrToGbnf({ toolNames: ["read_file", "mcp.tool:v2", "create-card", "a1"] })).not.toThrow();
	});
});

describe("collectGbnfRuleReferences (structural correctness — no rule referenced without a definition)", () => {
	it("the open grammar has no dangling rule references", () => {
		const { danglingReferences } = collectGbnfRuleReferences(actionPlanIrToGbnf());
		expect(danglingReferences).toEqual([]);
	});

	it("the tool-narrowed grammar has no dangling rule references", () => {
		const { danglingReferences } = collectGbnfRuleReferences(
			actionPlanIrToGbnf({ toolNames: ["read_file", "create_card", "run_commands"] }),
		);
		expect(danglingReferences).toEqual([]);
	});

	it("reports the defined rules and includes every rule the IR needs", () => {
		const { defined } = collectGbnfRuleReferences(actionPlanIrToGbnf());
		for (const rule of ["root", "step-array", "step", "string-array", "tool", "object", "value", "string", "ws"]) {
			expect(defined.has(rule), `expected rule "${rule}" to be defined`).toBe(true);
		}
	});

	it("does NOT read identifiers inside string terminals or char classes as references", () => {
		// `steps`, `id`, `dependsOn`, `true` appear ONLY inside string literals; `t`/`n` only inside a char class
		// ([ \t\n]). None of them are real rules, so none may show up as a reference. (`null` IS a real rule —
		// `null ::= "null"` referenced by `value` — so it is deliberately NOT in this list.)
		const { referenced } = collectGbnfRuleReferences(actionPlanIrToGbnf());
		for (const notARule of ["steps", "id", "dependsOn", "true"]) {
			expect(referenced.has(notARule), `"${notARule}" must not be seen as a rule reference`).toBe(false);
		}
	});

	it("DETECTS a genuine dangling reference (the checker actually works)", () => {
		const broken = 'root ::= object\nobject ::= "{" missing-rule "}"\n';
		const { danglingReferences } = collectGbnfRuleReferences(broken);
		expect(danglingReferences).toContain("missing-rule");
	});

	it("ignores comments when reading rules", () => {
		const withComment = "root ::= value # this mentions object but it is a comment\nvalue ::= [0-9]\n";
		const { danglingReferences, referenced } = collectGbnfRuleReferences(withComment);
		expect(referenced.has("value")).toBe(true);
		expect(referenced.has("object")).toBe(false); // the word in the comment is not a reference
		expect(danglingReferences).toEqual([]);
	});
});

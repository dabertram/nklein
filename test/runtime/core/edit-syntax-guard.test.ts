import { describe, expect, it } from "vitest";
import { checkEditSyntax } from "../../../src/core/edit-syntax-guard";

describe("checkEditSyntax (F12.63)", () => {
	it("passes valid TypeScript including strings/comments containing brackets", () => {
		const content = [
			"// a comment with } and ( inside",
			'const s = "a string with { and [";',
			"const t = `template with ) and ${JSON.stringify({ a: 1 })}`;",
			"/* block comment with { */",
			"export function f(a: number): number {",
			"\treturn a * 2;",
			"}",
		].join("\n");
		expect(checkEditSyntax("src/x.ts", content)).toEqual({ ok: true, issue: null });
	});

	it("rejects an unclosed brace with the opening line named", () => {
		const verdict = checkEditSyntax("src/x.ts", "function f() {\n\treturn 1;\n// missing close");
		expect(verdict.ok).toBe(false);
		expect(verdict.issue).toContain("Unclosed `{` opened at line 1");
	});

	it("rejects a mismatched closer and an unclosed template literal", () => {
		expect(checkEditSyntax("src/x.ts", "const a = (1 + 2];").ok).toBe(false);
		expect(checkEditSyntax("src/x.ts", "const s = `oops;").ok).toBe(false);
	});

	it("parses JSON for real and never guards non-code files", () => {
		expect(checkEditSyntax("config.json", '{"a": 1}').ok).toBe(true);
		expect(checkEditSyntax("config.json", '{"a": }').ok).toBe(false);
		expect(checkEditSyntax("notes.md", "unbalanced { everywhere ( in prose").ok).toBe(true);
	});

	it("handles python comments (# not //) without false positives", () => {
		expect(checkEditSyntax("script.py", "# comment with {\ndef f():\n\treturn [1, 2]").ok).toBe(true);
	});
});

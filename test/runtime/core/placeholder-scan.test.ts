import { describe, expect, it } from "vitest";
import { scanForPlaceholders } from "../../../src/core/placeholder-scan.js";

/** opencode-swarm port — the §4A "no built-but-not-wired" mechanical scanner. */
describe("scanForPlaceholders", () => {
	it("flags TODO/FIXME comment markers only inside comments, not in strings or prose paths", () => {
		const result = scanForPlaceholders([
			{ path: "a.ts", content: "// TODO: wire this\nconst x = 1; // FIXME later\nconst msg = 'the TODO list';" },
			{ path: "b.ts", content: "const path = 'docs/todo.md';\nconst todos = [];" },
		]);
		expect(result.summary.todo_comment).toBe(1);
		expect(result.summary.fixme_comment).toBe(1);
		// The string literal 'the TODO list', the path 'docs/todo.md', and the identifier `todos` must NOT fire.
		expect(result.findings.every((f) => f.path === "a.ts")).toBe(true);
	});

	it("flags not-implemented throws and NotImplementedError (attributed to the more-specific throw kind)", () => {
		const result = scanForPlaceholders([
			{ path: "c.ts", content: 'function f() {\n  throw new Error("not implemented");\n}' },
			{ path: "d.py", content: "def g():\n    raise NotImplementedError" },
		]);
		// `raise NotImplementedError` matches both, but the specific "unfinished work announced" kind wins (fires first).
		expect(result.summary.not_implemented_throw).toBe(2);
		expect(result.summary.stub_body).toBe(0);
		expect(result.hasPlaceholders).toBe(true);
	});

	it("flags stub bodies (pass / ...) and tagged placeholder returns", () => {
		const result = scanForPlaceholders([
			{ path: "e.py", content: "def h():\n    pass" },
			{ path: "f.ts", content: "function j() {\n  ...\n}" },
			{ path: "g.ts", content: "return null; // TODO real value" },
		]);
		expect(result.summary.stub_body).toBe(2);
		expect(result.summary.placeholder_return).toBe(1);
	});

	it("flags an empty catch that swallows the error with a placeholder note", () => {
		const result = scanForPlaceholders([{ path: "h.ts", content: "try { x(); } catch (e) { // ignore for now\n}" }]);
		expect(result.summary.empty_catch).toBe(1);
	});

	it("returns clean (no placeholders) for finished code", () => {
		const result = scanForPlaceholders([
			{ path: "i.ts", content: "export function add(a: number, b: number): number {\n  return a + b;\n}" },
		]);
		expect(result.hasPlaceholders).toBe(false);
		expect(result.findings).toEqual([]);
	});

	it("respects a narrowed marker set and reports 1-indexed lines", () => {
		const content = "line one\n// HACK: skip\n// TODO: keep";
		const withHack = scanForPlaceholders([{ path: "j.ts", content }]);
		expect(withHack.findings).toHaveLength(2);
		expect(withHack.findings[0]).toMatchObject({ line: 2, path: "j.ts" });

		// Narrow to TODO only → the HACK line no longer fires.
		const todoOnly = scanForPlaceholders([{ path: "j.ts", content }], { commentMarkers: ["TODO"] });
		expect(todoOnly.findings).toHaveLength(1);
		expect(todoOnly.findings[0].line).toBe(3);
	});
});

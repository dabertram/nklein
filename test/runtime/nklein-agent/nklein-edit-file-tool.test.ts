import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createEditFileTool, parseEditFileRequest } from "../../../src/nklein-agent/nklein-edit-file-tool";

describe("parseEditFileRequest", () => {
	it("accepts an edits array and field-name variants", () => {
		expect(parseEditFileRequest({ path: "a.ts", edits: [{ search: "x", replace: "y" }] })).toEqual({
			path: "a.ts",
			edits: [{ search: "x", replace: "y" }],
		});
		expect(parseEditFileRequest({ path: "a.ts", old_string: "x", new_string: "y" })).toEqual({
			path: "a.ts",
			edits: [{ search: "x", replace: "y" }],
		});
		expect(parseEditFileRequest({ path: "a.ts", edits: '[{"search":"x","replace":"y"}]' })).toEqual({
			path: "a.ts",
			edits: [{ search: "x", replace: "y" }],
		});
	});

	it("#38 (run37): parses the insert-at-line idiom and the SDK editor's old_text/new_text pair", () => {
		const insert = parseEditFileRequest({ path: "src/a.ts", insert_line: 30, new_text: "inserted\n" });
		expect(insert).toEqual({ path: "src/a.ts", edits: [], insert: { line: 30, text: "inserted\n" } });
		const editorPair = parseEditFileRequest({ path: "src/a.ts", old_text: "before", new_text: "after" });
		expect(editorPair?.edits).toEqual([{ search: "before", replace: "after" }]);
		// old_text present ⇒ a REPLACE even if a line number tags along.
		const both = parseEditFileRequest({ path: "src/a.ts", old_text: "x", new_text: "y", insert_line: 2 });
		expect(both?.insert).toBeUndefined();
	});

	it("#42 (run42): coerces a numeric-string insert_line and honors new_text-only as whole-file replace", () => {
		const coerced = parseEditFileRequest({ path: "src/a.ts", insert_line: "42", new_text: "x" });
		expect(coerced?.insert).toEqual({ line: 42, text: "x" });
		const replace = parseEditFileRequest({ path: "src/a.ts", new_text: "whole new content" });
		expect(replace?.replaceAll).toBe("whole new content");
		expect(replace?.insert).toBeUndefined();
	});

	it("rejects missing path or edits", () => {
		expect(parseEditFileRequest({ edits: [{ search: "x", replace: "y" }] })).toBeNull();
		expect(parseEditFileRequest({ path: "a.ts" })).toBeNull();
	});

	// §5.BF 2026-07-11 (#42 regression): a present non-empty `edits` array is the PRIMARY intent — a stray top-level
	// text/new_text (commentary a weak model adds, and new_text is in the schema) must NOT hijack it into a
	// whole-file replace that silently drops the edits and clobbers the file.
	it("#42 regression: a non-empty edits array WINS over a stray top-level text/new_text (no whole-file clobber)", () => {
		const withText = parseEditFileRequest({
			path: "src/routes.ts",
			edits: [{ search: "import a", replace: "import a, b" }],
			text: "add b to the import",
		});
		expect(withText).toEqual({ path: "src/routes.ts", edits: [{ search: "import a", replace: "import a, b" }] });
		expect(withText?.replaceAll).toBeUndefined();

		const withNewText = parseEditFileRequest({
			path: "src/routes.ts",
			edits: [{ search: "x", replace: "y" }],
			new_text: "commentary",
			insert_line: 3,
		});
		expect(withNewText).toEqual({ path: "src/routes.ts", edits: [{ search: "x", replace: "y" }] });
		expect(withNewText?.replaceAll).toBeUndefined();
		expect(withNewText?.insert).toBeUndefined();

		// A STRING-encoded edits array (the repair path) also wins over a stray new_text.
		const stringEdits = parseEditFileRequest({
			path: "src/routes.ts",
			edits: '[{"search":"x","replace":"y"}]',
			new_text: "commentary",
		});
		expect(stringEdits?.edits).toEqual([{ search: "x", replace: "y" }]);
		expect(stringEdits?.replaceAll).toBeUndefined();
	});

	it("#42: an EMPTY edits array still allows the new_text-only whole-file replace idiom", () => {
		const replace = parseEditFileRequest({ path: "src/a.ts", edits: [], new_text: "whole new content" });
		expect(replace?.replaceAll).toBe("whole new content");
	});
});

describe("edit_file tool", () => {
	let workspacePath: string;

	beforeEach(async () => {
		workspacePath = await mkdtemp(join(tmpdir(), "nklein-edit-file-"));
	});

	afterEach(async () => {
		await rm(workspacePath, { force: true, recursive: true });
	});

	it("applies a lenient edit and writes the file", async () => {
		await writeFile(join(workspacePath, "math.ts"), "function add(a, b) {\n\treturn a + b;\n}\n", "utf8");
		const tool = createEditFileTool({ workspacePath });
		// 2-space indent in search vs the file's tab; whitespace-flexible match handles it.
		const result = (await tool.execute(
			{ path: "math.ts", edits: [{ search: "  return a + b;\n", replace: "  return a - b;\n" }] },
			undefined as never,
		)) as { changed: boolean; strategies: string[] };
		expect(result.changed).toBe(true);
		expect(result.strategies).toContain("whitespace");
		expect(await readFile(join(workspacePath, "math.ts"), "utf8")).toContain("\treturn a - b;");
	});

	it("#38: inserts new_text before the one-based line and clamps past-EOF to append", async () => {
		const tool = createEditFileTool({ workspacePath });
		await writeFile(join(workspacePath, "ins.txt"), "one\ntwo\nthree", "utf8");
		await tool.execute({ path: "ins.txt", insert_line: 2, new_text: "between" }, undefined as never);
		expect(await readFile(join(workspacePath, "ins.txt"), "utf8")).toBe("one\nbetween\ntwo\nthree");
		await tool.execute({ path: "ins.txt", insert_line: 99, new_text: "tail" }, undefined as never);
		expect(await readFile(join(workspacePath, "ins.txt"), "utf8")).toBe("one\nbetween\ntwo\nthree\ntail");
	});

	it("#42: replaces the whole file via new_text-only, through the same guards", async () => {
		const tool = createEditFileTool({ workspacePath });
		await writeFile(join(workspacePath, "whole.txt"), "old content", "utf8");
		await tool.execute({ path: "whole.txt", new_text: "brand new body" }, undefined as never);
		expect(await readFile(join(workspacePath, "whole.txt"), "utf8")).toBe("brand new body");
	});

	it("fails with a corrective, similarity-annotated error when the search does not match", async () => {
		await writeFile(join(workspacePath, "a.ts"), "const x = 1;\n", "utf8");
		const tool = createEditFileTool({ workspacePath });
		await expect(
			tool.execute(
				{ path: "a.ts", edits: [{ search: "totally unrelated text\n", replace: "y\n" }] },
				undefined as never,
			),
		).rejects.toThrow(/did not match/);
	});

	it("refuses to edit a file that does not exist", async () => {
		const tool = createEditFileTool({ workspacePath });
		await expect(
			tool.execute({ path: "missing.ts", edits: [{ search: "x", replace: "y" }] }, undefined as never),
		).rejects.toThrow(/could not be read/);
	});
});

describe("edit_file workspace containment (§5.Y #4)", () => {
	let workspacePath: string;
	let outside: string;

	beforeEach(async () => {
		workspacePath = await mkdtemp(join(tmpdir(), "nklein-edit-contain-"));
		outside = await mkdtemp(join(tmpdir(), "nklein-edit-outside-"));
	});

	afterEach(async () => {
		await rm(workspacePath, { force: true, recursive: true });
		await rm(outside, { force: true, recursive: true });
	});

	it("rejects editing a host-absolute path outside the workspace root without touching it", async () => {
		await writeFile(join(outside, "secret.ts"), "const secret = 1;\n", "utf8");
		const tool = createEditFileTool({ workspacePath });
		await expect(
			tool.execute(
				{ path: join(outside, "secret.ts"), edits: [{ search: "const secret = 1;", replace: "pwned" }] },
				undefined as never,
			),
		).rejects.toThrow(/escapes the workspace|outside the workspace/);
		// Unchanged.
		expect(await readFile(join(outside, "secret.ts"), "utf8")).toBe("const secret = 1;\n");
	});

	it("rejects a `..` traversal escape", async () => {
		const tool = createEditFileTool({ workspacePath });
		await expect(
			tool.execute({ path: "../../../../etc/hosts", edits: [{ search: "x", replace: "y" }] }, undefined as never),
		).rejects.toThrow(/escapes the workspace|outside the workspace/);
	});

	it("rejects a symlinked-parent escape (real path lands outside) without editing the real target", async () => {
		await writeFile(join(outside, "secret.ts"), "const secret = 1;\n", "utf8");
		await symlink(outside, join(workspacePath, "evil-link"));
		const tool = createEditFileTool({ workspacePath });
		await expect(
			tool.execute(
				{ path: "evil-link/secret.ts", edits: [{ search: "const secret = 1;", replace: "pwned" }] },
				undefined as never,
			),
		).rejects.toThrow(/escapes the workspace|outside the workspace/);
		expect(await readFile(join(outside, "secret.ts"), "utf8")).toBe("const secret = 1;\n");
	});

	it("allows a host-absolute path within the workspace root (host/home session)", async () => {
		await writeFile(join(workspacePath, "math.ts"), "return a + b;\n", "utf8");
		const tool = createEditFileTool({ workspacePath });
		const result = (await tool.execute(
			{ path: join(workspacePath, "math.ts"), edits: [{ search: "return a + b;", replace: "return a - b;" }] },
			undefined as never,
		)) as { changed: boolean };
		expect(result.changed).toBe(true);
		expect(await readFile(join(workspacePath, "math.ts"), "utf8")).toContain("a - b");
	});
});

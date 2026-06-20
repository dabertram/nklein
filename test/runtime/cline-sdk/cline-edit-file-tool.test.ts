import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createEditFileTool, parseEditFileRequest } from "../../../src/cline-sdk/cline-edit-file-tool";

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

	it("rejects missing path or edits", () => {
		expect(parseEditFileRequest({ edits: [{ search: "x", replace: "y" }] })).toBeNull();
		expect(parseEditFileRequest({ path: "a.ts" })).toBeNull();
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

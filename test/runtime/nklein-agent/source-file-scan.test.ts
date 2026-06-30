import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import {
	listSourceFiles,
	MAX_FILE_BYTES,
	SKIPPED_DIRS,
	SOURCE_EXTENSIONS,
	shouldScanFile,
} from "../../../src/nklein-agent/source-file-scan";

describe("shouldScanFile", () => {
	it("accepts known source extensions (case-insensitively)", () => {
		expect(shouldScanFile("a.ts")).toBe(true);
		expect(shouldScanFile("b.py")).toBe(true);
		expect(shouldScanFile("C.TS")).toBe(true);
	});

	it("rejects non-source and extension-less files", () => {
		expect(shouldScanFile("notes.md")).toBe(false);
		expect(shouldScanFile("data.txt")).toBe(false);
		expect(shouldScanFile("Makefile")).toBe(false);
	});
});

describe("scan constants", () => {
	it("includes the expected source extensions and skipped dirs", () => {
		expect(SOURCE_EXTENSIONS.has(".tsx")).toBe(true);
		expect(SKIPPED_DIRS.has("node_modules")).toBe(true);
		expect(MAX_FILE_BYTES).toBe(512_000);
	});
});

describe("listSourceFiles", () => {
	const created: string[] = [];
	afterAll(async () => {
		const { rm } = await import("node:fs/promises");
		await Promise.all(created.map((dir) => rm(dir, { recursive: true, force: true })));
	});

	it("collects source files, skips ignored dirs, and drops oversized files", async () => {
		const root = await mkdtemp(join(tmpdir(), "klein-scan-"));
		created.push(root);
		await writeFile(join(root, "keep.ts"), "export const a = 1;");
		await writeFile(join(root, "skip.md"), "# not source");
		await writeFile(join(root, "huge.ts"), "x".repeat(MAX_FILE_BYTES + 1));
		await mkdir(join(root, "node_modules"));
		await writeFile(join(root, "node_modules", "dep.ts"), "export const dep = 1;");
		await mkdir(join(root, "src"));
		await writeFile(join(root, "src", "nested.ts"), "export const b = 2;");

		const found = (await listSourceFiles(root, 1000)).map((p) => p.replace(`${root}/`, "")).sort();
		expect(found).toEqual(["keep.ts", "src/nested.ts"]);
	});

	it("honors the maxFiles cap", async () => {
		const root = await mkdtemp(join(tmpdir(), "klein-scan-cap-"));
		created.push(root);
		await writeFile(join(root, "a.ts"), "1");
		await writeFile(join(root, "b.ts"), "2");
		await writeFile(join(root, "c.ts"), "3");
		expect((await listSourceFiles(root, 2)).length).toBe(2);
	});
});

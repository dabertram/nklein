import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { searchClineCodeIndex } from "../../../src/cline-sdk/cline-code-index";

async function createWorkspace(): Promise<string> {
	const workspacePath = await mkdtemp(join(tmpdir(), "kanban-code-index-"));
	await mkdir(join(workspacePath, "src"), { recursive: true });
	await writeFile(
		join(workspacePath, "src", "storage-adapter.ts"),
		[
			"export interface PersistenceDriver {",
			"  load(): Promise<string[]>;",
			"  save(items: string[]): Promise<void>;",
			"}",
			"export function createDriver(): PersistenceDriver {",
			"  return {",
			"    async load() { return []; },",
			"    async save() { return; },",
			"  };",
			"}",
		].join("\n"),
		"utf8",
	);
	return workspacePath;
}

describe("cline code index", () => {
	it("returns offline chunk matches using path and token-vector similarity", async () => {
		const workspacePath = await createWorkspace();

		const result = await searchClineCodeIndex({
			workspacePath,
			query: "storage adapter persistence",
			maxResults: 2,
			chunkLines: 20,
		});

		expect(result.filesScanned).toBe(1);
		expect(result.matches[0]).toMatchObject({
			path: "src/storage-adapter.ts",
			lineStart: 1,
		});
		expect(result.matches[0]?.text).toContain("PersistenceDriver");
	});
});

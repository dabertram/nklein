import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { searchWorkspaceFiles } from "../../src/workspace/search-workspace-files";
import { commitAllInTestRepository, initTestRepository } from "../utilities/git-repo";
import { createTempDir } from "../utilities/temp-dir";

describe.sequential("search workspace files runtime", () => {
	it("finds modified tracked files with non-ASCII paths using UTF-8 query text", async () => {
		const { path: repoPath, cleanup } = createTempDir("kanban-search-files-nonascii-tracked-");
		try {
			initTestRepository(repoPath);
			const directory = "提出書類";
			const fileName = "設計書.md";
			const relativePath = `${directory}/${fileName}`;
			mkdirSync(join(repoPath, directory), { recursive: true });
			writeFileSync(join(repoPath, relativePath), "first\n", "utf8");
			commitAllInTestRepository(repoPath, "add non-ascii tracked file");
			writeFileSync(join(repoPath, relativePath), "updated\n", "utf8");

			const results = await searchWorkspaceFiles(repoPath, "提出", 20);

			expect(results).toHaveLength(1);
			expect(results[0]).toEqual({
				path: relativePath,
				name: fileName,
				changed: true,
			});
		} finally {
			cleanup();
		}
	});

	it("finds untracked files with non-ASCII paths using UTF-8 query text", async () => {
		const { path: repoPath, cleanup } = createTempDir("kanban-search-files-nonascii-untracked-");
		try {
			initTestRepository(repoPath);
			const directory = "新規資料";
			const fileName = "メモ.txt";
			const relativePath = `${directory}/${fileName}`;
			mkdirSync(join(repoPath, directory), { recursive: true });
			writeFileSync(join(repoPath, relativePath), "draft\n", "utf8");

			const results = await searchWorkspaceFiles(repoPath, "新規", 20);

			expect(results).toHaveLength(1);
			expect(results[0]).toEqual({
				path: relativePath,
				name: fileName,
				changed: true,
			});
		} finally {
			cleanup();
		}
	});
});

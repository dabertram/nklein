import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createFileDiscoveryTools } from "../../../src/nklein-agent/nklein-file-discovery-tools";
import type { AgentToolContext } from "../../../src/nklein-agent/sdk-agent-types";

const TEMP_PREFIX = "kanban-file-discovery-tools-";
const TOOL_CONTEXT: AgentToolContext = {
	agentId: "agent-1",
	iteration: 1,
};

function getTool(tools: ReturnType<typeof createFileDiscoveryTools>, name: string) {
	const tool = tools.find((entry) => entry.name === name);
	if (!tool) {
		throw new Error(`Missing tool ${name}`);
	}
	return tool;
}

type DiscoveryEntry = {
	path: string;
	type: "file" | "directory" | "symlink" | "other";
	sizeBytes: number | null;
};

type ListFilesResult = {
	path: string;
	entries: DiscoveryEntry[];
	truncated: boolean;
};

type FindFilesResult = {
	files: DiscoveryEntry[];
};

type GetFileSizeResult = {
	path: string;
	sizeBytes: number;
	lineCount: number;
	tokenCount: number;
	useReadLargeFile: boolean;
	recommendedTool: "read_files" | "read_large_file";
};

describe("createFileDiscoveryTools", () => {
	const tempDirs: string[] = [];

	afterEach(async () => {
		await Promise.all(tempDirs.map(async (path) => rm(path, { recursive: true, force: true })));
		tempDirs.length = 0;
	});

	it("lists workspace files without reading contents", async () => {
		const workspacePath = await mkdtemp(join(tmpdir(), TEMP_PREFIX));
		tempDirs.push(workspacePath);
		await mkdir(join(workspacePath, "notes"));
		await writeFile(join(workspacePath, "plan.md"), "# Plan\n", "utf8");
		await writeFile(join(workspacePath, "notes", "card1.txt"), "details\n", "utf8");

		const listFiles = getTool(createFileDiscoveryTools({ workspacePath }), "list_files");
		const result = (await listFiles.execute({ recursive: true }, TOOL_CONTEXT)) as ListFilesResult;

		expect(result).toMatchObject({
			path: ".",
			truncated: false,
		});
		expect(result.entries).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ path: "plan.md", type: "file", sizeBytes: 7 }),
				expect.objectContaining({ path: "notes", type: "directory", sizeBytes: null }),
				expect.objectContaining({ path: "notes/card1.txt", type: "file", sizeBytes: 8 }),
			]),
		);
	});

	it("finds files by pattern and extension", async () => {
		const workspacePath = await mkdtemp(join(tmpdir(), TEMP_PREFIX));
		tempDirs.push(workspacePath);
		await mkdir(join(workspacePath, "input"));
		await writeFile(join(workspacePath, "input", "card1.txt"), "one", "utf8");
		await writeFile(join(workspacePath, "input", "card2.txt"), "two", "utf8");
		await writeFile(join(workspacePath, "input", "plan.md"), "plan", "utf8");

		const findFiles = getTool(createFileDiscoveryTools({ workspacePath }), "find_files");
		const result = (await findFiles.execute(
			{ path: "input", pattern: "card?.txt", extension: "txt" },
			TOOL_CONTEXT,
		)) as FindFilesResult;

		expect(result.files).toEqual([
			expect.objectContaining({ path: "input/card1.txt", type: "file" }),
			expect.objectContaining({ path: "input/card2.txt", type: "file" }),
		]);
	});

	it("maps host workspace absolute paths to the sandbox workspace for discovery tools", async () => {
		const workspacePath = await mkdtemp(join(tmpdir(), TEMP_PREFIX));
		const hostWorkspacePath = await mkdtemp(join(tmpdir(), "kanban-file-discovery-host-"));
		tempDirs.push(workspacePath, hostWorkspacePath);
		await mkdir(join(workspacePath, "src"));
		await writeFile(join(workspacePath, "src", "habit-score.ts"), "export const score = 1;\n", "utf8");

		const tools = createFileDiscoveryTools({ workspacePath, hostWorkspacePath });
		const listFiles = getTool(tools, "list_files");
		const findFiles = getTool(tools, "find_files");
		const getFileSize = getTool(tools, "get_file_size");

		const listed = (await listFiles.execute(
			{ path: join(hostWorkspacePath, "src"), recursive: true },
			TOOL_CONTEXT,
		)) as ListFilesResult;
		const found = (await findFiles.execute(
			{ path: hostWorkspacePath, query: "habit" },
			TOOL_CONTEXT,
		)) as FindFilesResult;
		const size = (await getFileSize.execute(
			{ path: join(hostWorkspacePath, "src", "habit-score.ts") },
			TOOL_CONTEXT,
		)) as GetFileSizeResult;

		expect(listed.path).toBe("src");
		expect(listed.entries).toEqual([expect.objectContaining({ path: "src/habit-score.ts", type: "file" })]);
		expect(found.files).toEqual([expect.objectContaining({ path: "src/habit-score.ts", type: "file" })]);
		expect(size.path).toBe("src/habit-score.ts");
	});

	it("returns file size metadata and read tool recommendation", async () => {
		const workspacePath = await mkdtemp(join(tmpdir(), TEMP_PREFIX));
		tempDirs.push(workspacePath);
		await writeFile(join(workspacePath, "small.txt"), "line 1\nline 2\n", "utf8");

		const getFileSize = getTool(createFileDiscoveryTools({ workspacePath, contextWindow: 80_000 }), "get_file_size");
		const result = (await getFileSize.execute({ path: "small.txt" }, TOOL_CONTEXT)) as GetFileSizeResult;

		expect(result).toMatchObject({
			path: "small.txt",
			sizeBytes: 14,
			lineCount: 3,
			useReadLargeFile: false,
			recommendedTool: "read_files",
		});
		expect(result.tokenCount).toEqual(expect.any(Number));
	});

	it("recommends read_files for byte-large files that fit the context budget", async () => {
		const workspacePath = await mkdtemp(join(tmpdir(), TEMP_PREFIX));
		tempDirs.push(workspacePath);
		const content = "a".repeat(120 * 1024);
		await writeFile(join(workspacePath, "long-but-simple.txt"), content, "utf8");

		const getFileSize = getTool(createFileDiscoveryTools({ workspacePath, contextWindow: 80_000 }), "get_file_size");
		const result = (await getFileSize.execute({ path: "long-but-simple.txt" }, TOOL_CONTEXT)) as GetFileSizeResult;

		expect(result.sizeBytes).toBeGreaterThan(100 * 1024);
		expect(result.useReadLargeFile).toBe(false);
		expect(result.recommendedTool).toBe("read_files");
	});

	it("blocks paths outside the workspace", async () => {
		const workspacePath = await mkdtemp(join(tmpdir(), TEMP_PREFIX));
		tempDirs.push(workspacePath);
		const listFiles = getTool(createFileDiscoveryTools({ workspacePath }), "list_files");

		await expect(listFiles.execute({ path: ".." }, TOOL_CONTEXT)).rejects.toThrow("outside the workspace");
	});
});

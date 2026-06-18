import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentToolContext } from "@clinebot/shared";
import { afterEach, describe, expect, it } from "vitest";

import {
	createWriteFilesTool,
	createWriteFileTool,
	parseWriteFilesRequests,
} from "../../../src/cline-sdk/cline-write-files-tool";

const TEMP_PREFIX = "kanban-write-files-tool-";
const TOOL_CONTEXT: AgentToolContext = {
	agentId: "agent-1",
	iteration: 1,
};

describe("createWriteFilesTool", () => {
	const tempDirs: string[] = [];

	afterEach(async () => {
		await Promise.all(tempDirs.map(async (path) => rm(path, { recursive: true, force: true })));
		tempDirs.length = 0;
	});

	it("creates requested output files and parent directories", async () => {
		const workspacePath = await mkdtemp(join(tmpdir(), TEMP_PREFIX));
		tempDirs.push(workspacePath);
		const tool = createWriteFilesTool({ workspacePath, maxFileLines: 10 });

		const result = await tool.execute(
			{
				files: [{ path: "plans/new_plan.md", content: "# Plan\n\nDetails\n" }],
			},
			TOOL_CONTEXT,
		);

		expect(result).toMatchObject({
			written: [{ path: "plans/new_plan.md", lines: 4 }],
		});
		await expect(readFile(join(workspacePath, "plans", "new_plan.md"), "utf8")).resolves.toBe("# Plan\n\nDetails\n");
	});

	it("blocks files above the configured line limit before writing", async () => {
		const workspacePath = await mkdtemp(join(tmpdir(), TEMP_PREFIX));
		tempDirs.push(workspacePath);
		const tool = createWriteFilesTool({ workspacePath, maxFileLines: 2 });

		await expect(
			tool.execute(
				{
					files: [{ path: "too-large.md", content: "one\ntwo\nthree" }],
				},
				TOOL_CONTEXT,
			),
		).rejects.toThrow("2-line file limit");
	});

	it("blocks obvious secrets before writing any batch entries", async () => {
		const workspacePath = await mkdtemp(join(tmpdir(), TEMP_PREFIX));
		tempDirs.push(workspacePath);
		const tool = createWriteFilesTool({ workspacePath, maxFileLines: 10 });

		await expect(
			tool.execute(
				{
					files: [
						{ path: "safe.txt", content: "safe\n" },
						{
							path: ".env",
							content: "ANTHROPIC_API_KEY=sk-ant-1234567890abcdefghijklmnopqrstuvwxyz",
						},
					],
				},
				TOOL_CONTEXT,
			),
		).rejects.toThrow("potential Anthropic API key");
		await expect(readFile(join(workspacePath, "safe.txt"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
		await expect(readFile(join(workspacePath, ".env"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
	});

	it("blocks protected suite paths before writing any batch entries", async () => {
		const workspacePath = await mkdtemp(join(tmpdir(), TEMP_PREFIX));
		tempDirs.push(workspacePath);
		const tool = createWriteFilesTool({ workspacePath, maxFileLines: 10 });

		await expect(
			tool.execute(
				{
					files: [
						{ path: "safe.txt", content: "safe\n" },
						{ path: "test/protected/protected-tests.json", content: "{}\n" },
					],
				},
				TOOL_CONTEXT,
			),
		).rejects.toThrow(/protected test suite.*ask_followup_question/s);
		await expect(readFile(join(workspacePath, "safe.txt"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
	});

	it("rejects batches with missing content instead of silently dropping entries", async () => {
		const workspacePath = await mkdtemp(join(tmpdir(), TEMP_PREFIX));
		tempDirs.push(workspacePath);
		const tool = createWriteFilesTool({ workspacePath, maxFileLines: 10 });

		await expect(
			tool.execute(
				{
					files: [{ path: "valid.md", content: "valid\n" }, { path: "missing-content.md" }],
				},
				TOOL_CONTEXT,
			),
		).rejects.toThrow("write_files requires path and content fields");
		await expect(readFile(join(workspacePath, "valid.md"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
	});
});

describe("createWriteFileTool", () => {
	const tempDirs: string[] = [];

	afterEach(async () => {
		await Promise.all(tempDirs.map(async (path) => rm(path, { recursive: true, force: true })));
		tempDirs.length = 0;
	});

	it("creates a single requested output file", async () => {
		const workspacePath = await mkdtemp(join(tmpdir(), TEMP_PREFIX));
		tempDirs.push(workspacePath);
		const tool = createWriteFileTool({ workspacePath, maxFileLines: 10 });

		const result = await tool.execute(
			{
				path: "plans/new_plan.md",
				content: "# Plan\n",
			},
			TOOL_CONTEXT,
		);

		expect(result).toMatchObject({
			written: [{ path: "plans/new_plan.md", lines: 2 }],
		});
		await expect(readFile(join(workspacePath, "plans", "new_plan.md"), "utf8")).resolves.toBe("# Plan\n");
	});

	it("advertises path and content as required for write_file", () => {
		const tool = createWriteFileTool({ workspacePath: "/tmp/workspace", maxFileLines: 10 });

		expect(tool.inputSchema).toMatchObject({
			required: ["path", "content"],
			properties: {
				path: { type: "string" },
				content: { type: "string" },
			},
		});
	});

	it("rejects path-only write_file calls instead of writing an empty file", async () => {
		const workspacePath = await mkdtemp(join(tmpdir(), TEMP_PREFIX));
		tempDirs.push(workspacePath);
		const tool = createWriteFileTool({ workspacePath, maxFileLines: 10 });

		await expect(
			tool.execute(
				{
					path: "plans/new_plan.md",
				},
				TOOL_CONTEXT,
			),
		).rejects.toThrow("write_file requires path and content fields");
		await expect(readFile(join(workspacePath, "plans", "new_plan.md"), "utf8")).rejects.toMatchObject({
			code: "ENOENT",
		});
	});

	it("treats an empty content string as an explicit empty file", async () => {
		const workspacePath = await mkdtemp(join(tmpdir(), TEMP_PREFIX));
		tempDirs.push(workspacePath);
		const tool = createWriteFileTool({ workspacePath, maxFileLines: 10 });

		const result = await tool.execute(
			{
				path: "empty.md",
				content: "",
			},
			TOOL_CONTEXT,
		);

		expect(result).toMatchObject({
			written: [{ path: "empty.md", lines: 0 }],
		});
		await expect(readFile(join(workspacePath, "empty.md"), "utf8")).resolves.toBe("");
	});

	it("accepts file_path as a compatibility alias", async () => {
		const workspacePath = await mkdtemp(join(tmpdir(), TEMP_PREFIX));
		tempDirs.push(workspacePath);
		const tool = createWriteFileTool({ workspacePath, maxFileLines: 10 });

		await tool.execute(
			{
				file_path: "compat.md",
				content: "compat\n",
			},
			TOOL_CONTEXT,
		);

		await expect(readFile(join(workspacePath, "compat.md"), "utf8")).resolves.toBe("compat\n");
	});
});

describe("parseWriteFilesRequests", () => {
	it("returns no request for the path-only write_file shape from failed chat logs", () => {
		expect(parseWriteFilesRequests({ path: "/tmp/new_plan.md" })).toEqual([]);
	});

	it("keeps explicit empty string content", () => {
		expect(parseWriteFilesRequests({ path: "/tmp/empty.md", content: "" })).toEqual([
			{ path: "/tmp/empty.md", content: "" },
		]);
	});
});

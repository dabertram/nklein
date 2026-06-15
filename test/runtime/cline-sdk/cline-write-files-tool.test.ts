import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentToolContext } from "@clinebot/shared";
import { afterEach, describe, expect, it } from "vitest";

import { createWriteFilesTool, createWriteFileTool } from "../../../src/cline-sdk/cline-write-files-tool";

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

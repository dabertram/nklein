import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentToolContext } from "@nklein/shared";
import { afterEach, describe, expect, it } from "vitest";

import {
	createWriteFilesTool,
	createWriteFileTool,
	parseWriteFilesRequests,
} from "../../../src/nklein-sdk/nklein-write-files-tool";

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

	it("accepts JSON-stringified batch files from small models", async () => {
		const workspacePath = await mkdtemp(join(tmpdir(), TEMP_PREFIX));
		tempDirs.push(workspacePath);
		const tool = createWriteFilesTool({ workspacePath, maxFileLines: 10 });

		const result = await tool.execute(
			{
				files: JSON.stringify([{ path: "plans/stringified.md", content: "Details\n" }]),
			},
			TOOL_CONTEXT,
		);

		expect(result).toMatchObject({
			written: [{ path: "plans/stringified.md", lines: 2 }],
		});
		await expect(readFile(join(workspacePath, "plans", "stringified.md"), "utf8")).resolves.toBe("Details\n");
	});

	it("ignores harmless extra file-entry keys from confused write retries", async () => {
		const workspacePath = await mkdtemp(join(tmpdir(), TEMP_PREFIX));
		tempDirs.push(workspacePath);
		const tool = createWriteFilesTool({ workspacePath, maxFileLines: 10 });

		await tool.execute(
			{
				files: [
					{
						path: "plans/extra-keys.md",
						content: "Details\n",
						start_line: 1,
						end_line: null,
					},
				],
			},
			TOOL_CONTEXT,
		);

		await expect(readFile(join(workspacePath, "plans", "extra-keys.md"), "utf8")).resolves.toBe("Details\n");
	});

	it("advertises tolerant file-entry objects in the write_files schema", () => {
		const tool = createWriteFilesTool({ workspacePath: "/tmp/workspace", maxFileLines: 10 });
		const properties = tool.inputSchema.properties as Record<string, { anyOf?: readonly Record<string, unknown>[] }>;
		const arraySchema = properties.files?.anyOf?.find((schema) => schema.type === "array") as
			| { items?: { additionalProperties?: unknown } }
			| undefined;

		expect(arraySchema?.items?.additionalProperties).toBe(true);
	});

	it("advertises stringified batch files in the write_files schema", () => {
		const tool = createWriteFilesTool({ workspacePath: "/tmp/workspace", maxFileLines: 10 });
		const properties = tool.inputSchema.properties as Record<string, { anyOf?: readonly Record<string, unknown>[] }>;

		expect(properties.files?.anyOf).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ type: "array" }),
				expect.objectContaining({ type: "string" }),
			]),
		);
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

describe("write tool workspace containment (§5.Y #4)", () => {
	const tempDirs: string[] = [];

	afterEach(async () => {
		await Promise.all(tempDirs.map(async (path) => rm(path, { recursive: true, force: true })));
		tempDirs.length = 0;
	});

	it("allows a host-absolute path within the workspace root (host/home session, or container path == root)", async () => {
		const workspacePath = await mkdtemp(join(tmpdir(), TEMP_PREFIX));
		tempDirs.push(workspacePath);
		const tool = createWriteFileTool({ workspacePath, maxFileLines: 10 });

		// An absolute path UNDER the root is the legitimate home/host-session form, and also models the in-container
		// case where the tool's root IS `/workspaces/<taskId>` and the path is `/workspaces/<taskId>/...`.
		await tool.execute({ path: join(workspacePath, "in-root.md"), content: "ok\n" }, TOOL_CONTEXT);
		await expect(readFile(join(workspacePath, "in-root.md"), "utf8")).resolves.toBe("ok\n");
	});

	it("rejects a host-absolute path outside the workspace root and writes nothing", async () => {
		const workspacePath = await mkdtemp(join(tmpdir(), TEMP_PREFIX));
		const outside = await mkdtemp(join(tmpdir(), "kanban-write-outside-"));
		tempDirs.push(workspacePath, outside);
		const tool = createWriteFileTool({ workspacePath, maxFileLines: 10 });

		const target = join(outside, "escaped.md");
		await expect(tool.execute({ path: target, content: "leak\n" }, TOOL_CONTEXT)).rejects.toThrow(
			/escapes the workspace|outside the workspace/,
		);
		await expect(readFile(target, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
	});

	it("rejects a `..` traversal escape and writes nothing", async () => {
		const workspacePath = await mkdtemp(join(tmpdir(), TEMP_PREFIX));
		tempDirs.push(workspacePath);
		const tool = createWriteFileTool({ workspacePath, maxFileLines: 10 });

		await expect(
			tool.execute({ path: "../../../../escaped-relative.md", content: "leak\n" }, TOOL_CONTEXT),
		).rejects.toThrow(/escapes the workspace|outside the workspace/);
	});

	it("rejects a symlinked-parent escape (real path lands outside the workspace)", async () => {
		const workspacePath = await mkdtemp(join(tmpdir(), TEMP_PREFIX));
		const outside = await mkdtemp(join(tmpdir(), "kanban-write-symlink-outside-"));
		tempDirs.push(workspacePath, outside);
		// A symlink INSIDE the workspace pointing OUT — passes the lexical check but the real path escapes.
		await symlink(outside, join(workspacePath, "evil-link"));
		const tool = createWriteFileTool({ workspacePath, maxFileLines: 10 });

		await expect(tool.execute({ path: "evil-link/escaped.md", content: "leak\n" }, TOOL_CONTEXT)).rejects.toThrow(
			/escapes the workspace|outside the workspace/,
		);
		await expect(readFile(join(outside, "escaped.md"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
	});

	it("allows a normal workspace-relative subdirectory write", async () => {
		const workspacePath = await mkdtemp(join(tmpdir(), TEMP_PREFIX));
		tempDirs.push(workspacePath);
		await mkdir(join(workspacePath, "src"), { recursive: true });
		await writeFile(join(workspacePath, "src", "existing.ts"), "old\n", "utf8");
		const tool = createWriteFileTool({ workspacePath, maxFileLines: 10 });

		await tool.execute({ path: "src/nested/new.ts", content: "new\n" }, TOOL_CONTEXT);
		await expect(readFile(join(workspacePath, "src", "nested", "new.ts"), "utf8")).resolves.toBe("new\n");
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

	it("parses JSON-stringified files arrays", () => {
		expect(
			parseWriteFilesRequests({
				files: JSON.stringify([{ path: "/tmp/stringified.md", content: "text\n" }]),
			}),
		).toEqual([{ path: "/tmp/stringified.md", content: "text\n" }]);
	});
});

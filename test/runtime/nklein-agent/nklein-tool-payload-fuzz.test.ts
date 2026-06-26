import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createNKleinDecompositionTools } from "../../../src/nklein-agent/nklein-decomposition-tool";
import { createFileDiscoveryTools } from "../../../src/nklein-agent/nklein-file-discovery-tools";
import { createWriteFilesTool, createWriteFileTool } from "../../../src/nklein-agent/nklein-write-files-tool";

/**
 * todo.md §5.E: extend the "near-valid tool payload" fuzz coverage beyond decompose_project to the other
 * locally-owned tools small models drive — expand_task, write_file(s), and the discovery tools. Each must
 * tolerate the recoverable shapes (stringified nested JSON, numeric/boolean-as-string, harmless extra keys,
 * the file_path alias) while still failing clearly on genuinely unusable input. (run_command is the SDK-owned
 * sandboxed bash bridge with no local schema-recovery surface, so it is out of scope here.)
 */

async function createWorkspace(prefix: string): Promise<string> {
	return await mkdtemp(join(tmpdir(), prefix));
}

const VALID_GRAPH = {
	schemaVersion: 1,
	slug: "oversized-feature",
	title: "Oversized feature split",
	tasks: [
		{
			id: "schema",
			title: "Define schema",
			prompt: "Define the persistence schema.",
			dependsOn: [],
			complexity: 25,
			filesLikelyTouched: ["src/schema.ts"],
			acceptanceCommand: "npm test",
		},
		{
			id: "api",
			title: "Build the API",
			prompt: "Build the API over the schema.",
			dependsOn: ["schema"],
			complexity: 40,
			filesLikelyTouched: ["src/api.ts"],
			acceptanceCommand: "npm test",
		},
	],
};

type ExpandResult = { ok: boolean; taskCount: number; dependencyCount: number };

async function runExpandTask(taskGraph: unknown): Promise<ExpandResult> {
	const workspacePath = await createWorkspace("nklein-expand-fuzz-");
	const tool = createNKleinDecompositionTools({ workspacePath }).find((candidate) => candidate.name === "expand_task");
	if (!tool) {
		throw new Error("Missing expand_task tool");
	}
	return (await tool.execute({ taskGraph }, undefined as never)) as ExpandResult;
}

describe("expand_task near-valid payload tolerance", () => {
	it("tolerates a plain replacement graph object", async () => {
		const result = await runExpandTask(VALID_GRAPH);
		expect(result.ok).toBe(true);
		expect(result.taskCount).toBe(2);
		expect(result.dependencyCount).toBe(1);
	});

	it("recovers a JSON-stringified replacement graph (small models stringify nested objects)", async () => {
		const result = await runExpandTask(JSON.stringify(VALID_GRAPH));
		expect(result.ok).toBe(true);
		expect(result.taskCount).toBe(2);
	});

	it("recovers a stringified graph with a stray trailing brace", async () => {
		const result = await runExpandTask(`${JSON.stringify(VALID_GRAPH)}}`);
		expect(result.ok).toBe(true);
		expect(result.taskCount).toBe(2);
	});

	it("rejects a graph with a dangling dependency with an error", async () => {
		await expect(
			runExpandTask({
				schemaVersion: 1,
				slug: "broken",
				title: "Broken graph",
				tasks: [
					{
						id: "only",
						title: "Only task",
						prompt: "Do it.",
						dependsOn: ["missing"],
						acceptanceCommand: "npm test",
					},
				],
			}),
		).rejects.toThrow();
	});
});

describe("write_file(s) near-valid payload tolerance", () => {
	it("write_files recovers a JSON-stringified files array", async () => {
		const workspacePath = await createWorkspace("nklein-write-fuzz-");
		const tool = createWriteFilesTool({ workspacePath, maxFileLines: 400 });
		const result = (await tool.execute(
			{ files: JSON.stringify([{ path: "a.txt", content: "alpha" }]) },
			undefined as never,
		)) as { written: Array<{ path: string }> };
		expect(result.written).toHaveLength(1);
		expect(await readFile(join(workspacePath, "a.txt"), "utf8")).toBe("alpha");
	});

	it("write_file accepts the file_path alias small models emit", async () => {
		const workspacePath = await createWorkspace("nklein-write-fuzz-");
		const tool = createWriteFileTool({ workspacePath, maxFileLines: 400 });
		const result = (await tool.execute({ file_path: "aliased.txt", content: "from alias" }, undefined as never)) as {
			written: Array<{ path: string }>;
		};
		expect(result.written).toHaveLength(1);
		expect(await readFile(join(workspacePath, "aliased.txt"), "utf8")).toBe("from alias");
	});

	it("write_files tolerates harmless extra keys on each entry", async () => {
		const workspacePath = await createWorkspace("nklein-write-fuzz-");
		const tool = createWriteFilesTool({ workspacePath, maxFileLines: 400 });
		const result = (await tool.execute(
			{ files: [{ path: "b.txt", content: "beta", note: "scratch", line: 1 }] },
			undefined as never,
		)) as { written: Array<{ path: string }> };
		expect(result.written).toHaveLength(1);
	});

	it("write_file rejects a payload missing content with a clear instruction", async () => {
		const workspacePath = await createWorkspace("nklein-write-fuzz-");
		const tool = createWriteFileTool({ workspacePath, maxFileLines: 400 });
		await expect(tool.execute({ path: "missing.txt" }, undefined as never)).rejects.toThrow(/path and content/);
	});
});

describe("discovery tools near-valid payload tolerance", () => {
	async function createSeededWorkspace(): Promise<string> {
		const workspacePath = await createWorkspace("nklein-discovery-fuzz-");
		await writeFile(join(workspacePath, "alpha.ts"), "export const a = 1;\n", "utf8");
		await writeFile(join(workspacePath, "beta.md"), "# beta\n", "utf8");
		return workspacePath;
	}

	it("list_files coerces boolean/number-as-string options instead of throwing", async () => {
		const workspacePath = await createSeededWorkspace();
		const tool = createFileDiscoveryTools({ workspacePath }).find((candidate) => candidate.name === "list_files");
		const result = (await tool?.execute(
			{ recursive: "true", maxResults: "50", maxDepth: "2" },
			undefined as never,
		)) as { entries: unknown[] };
		expect(Array.isArray(result.entries)).toBe(true);
		expect(result.entries.length).toBeGreaterThan(0);
	});

	it("find_files clamps an out-of-range maxResults and matches by extension", async () => {
		const workspacePath = await createSeededWorkspace();
		const tool = createFileDiscoveryTools({ workspacePath }).find((candidate) => candidate.name === "find_files");
		const result = (await tool?.execute(
			{ extension: ".ts", maxResults: 999_999, maxDepth: -5 },
			undefined as never,
		)) as { files: Array<{ path: string }> };
		expect(result.files.some((file) => file.path.endsWith("alpha.ts"))).toBe(true);
		expect(result.files.some((file) => file.path.endsWith("beta.md"))).toBe(false);
	});

	it("get_file_size rejects a missing path with a clear instruction", async () => {
		const workspacePath = await createSeededWorkspace();
		const tool = createFileDiscoveryTools({ workspacePath }).find((candidate) => candidate.name === "get_file_size");
		await expect(tool?.execute({}, undefined as never)).rejects.toThrow(/non-empty path/);
	});
});

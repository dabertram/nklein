import { mkdir, mkdtemp, readFile, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	createHierarchicalRepoSummaryTool,
	type RepoSummaryModelCaller,
	type RepoSummaryRequest,
	readHierarchicalRepoSummaryArtifact,
	refreshHierarchicalRepoSummary,
} from "../../../src/nklein-agent/nklein-hierarchical-repo-summary";

async function createRepo(): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "nklein-hierarchical-summary-"));
	await mkdir(join(root, "src", "nested"), { recursive: true });
	await writeFile(
		join(root, "src", "math.ts"),
		[
			"export function add(left: number, right: number): number { return left + right; }",
			"export function subtract(left: number, right: number): number { return left - right; }",
		].join("\n"),
		"utf8",
	);
	await writeFile(
		join(root, "src", "nested", "label.ts"),
		"export const label = (value: number): string => 'value:' + String(value);",
		"utf8",
	);
	return root;
}

function recordingCaller(calls: RepoSummaryRequest[][]): RepoSummaryModelCaller {
	return async (requests) => {
		calls.push([...requests]);
		return new Map(requests.map((request) => [request.id, `${request.kind} summary for ${request.name}`]));
	};
}

describe("hierarchical repository summary (F11.2l)", () => {
	it("builds function -> file -> directory -> project and serves it top-down", async () => {
		const workspacePath = await createRepo();
		const calls: RepoSummaryRequest[][] = [];
		const result = await refreshHierarchicalRepoSummary({
			workspacePath,
			summarize: recordingCaller(calls),
			tokenBudget: 2_000,
		});

		expect(result.cacheHit).toBe(false);
		expect(result.modelNodesSummarized).toBeGreaterThan(7);
		expect(result.artifact.nodes.some((node) => node.kind === "function" && node.name === "add")).toBe(true);
		expect(result.artifact.nodes.some((node) => node.kind === "file" && node.path === "src/math.ts")).toBe(true);
		expect(result.artifact.nodes.some((node) => node.kind === "directory" && node.path === "src/nested")).toBe(true);
		expect(result.artifact.nodes.some((node) => node.kind === "project")).toBe(true);
		expect(result.rendered.indexOf("project project")).toBeLessThan(result.rendered.indexOf("directory src"));
		expect(result.rendered.indexOf("directory src")).toBeLessThan(result.rendered.indexOf("file src/math.ts"));
		expect(result.rendered).toContain("function src/math.ts:add");
		expect(calls[0]?.every((request) => request.kind === "function")).toBe(true);
	});

	it("returns an unchanged Merkle root without parsing or calling the model", async () => {
		const workspacePath = await createRepo();
		await refreshHierarchicalRepoSummary({ workspacePath, summarize: recordingCaller([]) });
		const calls: RepoSummaryRequest[][] = [];

		const cached = await refreshHierarchicalRepoSummary({ workspacePath, summarize: recordingCaller(calls) });

		expect(cached.cacheHit).toBe(true);
		expect(cached.modelNodesSummarized).toBe(0);
		expect(cached.modelBatches).toBe(0);
		expect(calls).toHaveLength(0);
	});

	it("resummarizes only an edited function and its file/directory/project ancestors", async () => {
		const workspacePath = await createRepo();
		await refreshHierarchicalRepoSummary({ workspacePath, summarize: recordingCaller([]) });
		await writeFile(
			join(workspacePath, "src", "math.ts"),
			[
				"export function add(left: number, right: number): number { return left + right + 1; }",
				"export function subtract(left: number, right: number): number { return left - right; }",
			].join("\n"),
			"utf8",
		);
		const calls: RepoSummaryRequest[][] = [];

		const refreshed = await refreshHierarchicalRepoSummary({ workspacePath, summarize: recordingCaller(calls) });
		const requested = calls.flat().map((request) => request.id);

		expect(refreshed.cacheHit).toBe(false);
		expect(requested.some((id) => id.includes(":add:"))).toBe(true);
		expect(requested.some((id) => id.includes(":subtract:"))).toBe(false);
		expect(requested).toContain("file:src/math.ts");
		expect(requested).toContain("directory:src");
		expect(requested).toContain("project:.");
		expect(requested).not.toContain("file:src/nested/label.ts");
		expect(requested).not.toContain("directory:src/nested");
	});

	it("persists an atomically readable artifact and prunes removed files", async () => {
		const workspacePath = await createRepo();
		const first = await refreshHierarchicalRepoSummary({ workspacePath, summarize: recordingCaller([]) });
		const persisted = await readHierarchicalRepoSummaryArtifact(workspacePath);
		expect(persisted?.fileTreeRootHash).toBe(first.artifact.fileTreeRootHash);
		const persistedText = await readFile(first.cachePath, "utf8");
		expect(() => JSON.parse(persistedText)).not.toThrow();

		await unlink(join(workspacePath, "src", "nested", "label.ts"));
		const refreshed = await refreshHierarchicalRepoSummary({ workspacePath, summarize: recordingCaller([]) });
		expect(refreshed.artifact.fileTreeRootHash).not.toBe(first.artifact.fileTreeRootHash);
		expect(refreshed.artifact.nodes.some((node) => node.path === "src/nested/label.ts")).toBe(false);
	});

	it("map-reduces wide files through cached digests before the parent request can overflow context", async () => {
		const workspacePath = await mkdtemp(join(tmpdir(), "nklein-wide-repo-summary-"));
		await writeFile(
			join(workspacePath, "wide.ts"),
			Array.from({ length: 120 }, (_, index) => `export function unit${index}(): number { return ${index}; }`).join(
				"\n",
			),
			"utf8",
		);
		const calls: RepoSummaryRequest[][] = [];
		const summarize: RepoSummaryModelCaller = async (requests) => {
			calls.push([...requests]);
			return new Map(requests.map((request) => [request.id, `${request.name} ${"detail ".repeat(45)}`]));
		};

		const result = await refreshHierarchicalRepoSummary({ workspacePath, summarize, maxBatchInputChars: 8_000 });

		expect(calls.flat().filter((request) => request.kind === "function")).toHaveLength(120);
		expect(calls.flat().some((request) => request.kind === "digest")).toBe(true);
		expect(Math.max(...calls.flat().map((request) => request.evidence.length))).toBeLessThan(8_000);
		expect(result.artifact.nodes.some((node) => node.kind === "digest")).toBe(true);
		expect(result.rendered).not.toContain("digest:");
	});

	it("exposes cold first-build as an explicit onboarding tool instead of hidden before-model latency", async () => {
		const workspacePath = await createRepo();
		const tool = createHierarchicalRepoSummaryTool({ workspacePath, summarize: recordingCaller([]) });

		const output = (await tool.execute({ tokenBudget: 800 }, { agentId: "agent-1", iteration: 1 })) as Record<
			string,
			unknown
		>;

		expect(output.map).toContain("Hierarchical repository summary");
		expect(output.filesScanned).toBe(2);
		expect(output.cacheHit).toBe(false);
		expect(output.instruction).toContain("untrusted source-derived orientation");
	});

	it("keeps Python and keyword-function languages at function granularity", async () => {
		const workspacePath = await mkdtemp(join(tmpdir(), "nklein-polyglot-repo-summary-"));
		await writeFile(
			join(workspacePath, "service.py"),
			[
				"def load_value(path):",
				"    return path.read_text()",
				"",
				"class Service:",
				"    def render(self, value):",
				"        return str(value)",
			].join("\n"),
			"utf8",
		);
		await writeFile(join(workspacePath, "main.go"), "package main\nfunc Run() int { return 1 }\n", "utf8");

		const result = await refreshHierarchicalRepoSummary({ workspacePath, summarize: recordingCaller([]) });
		const functionNames = result.artifact.nodes.filter((node) => node.kind === "function").map((node) => node.name);
		expect(functionNames).toEqual(expect.arrayContaining(["load_value", "render", "Run"]));
		expect(functionNames).not.toContain("<module>");
	});
});

import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createNKleinRetrievalTools } from "../../../src/nklein-agent/nklein-retrieval-tools";

async function createWorkspace(): Promise<string> {
	const workspacePath = await mkdtemp(join(tmpdir(), "kanban-retrieval-tools-"));
	await mkdir(join(workspacePath, "src"), { recursive: true });
	await writeFile(
		join(workspacePath, "src", "index.ts"),
		[
			"export function alphaFeature(): string {",
			"  return betaFeature();",
			"}",
			"export function betaFeature(): string {",
			"  return 'beta';",
			"}",
		].join("\n"),
		"utf8",
	);
	await writeFile(
		join(workspacePath, "src", "storage-adapter.ts"),
		["export function createDriver(): string {", "  return 'ok';", "}"].join("\n"),
		"utf8",
	);
	return workspacePath;
}

function getTool(name: string, workspacePath: string) {
	const tool = createNKleinRetrievalTools({ workspacePath }).find((candidate) => candidate.name === name);
	if (!tool) {
		throw new Error(`Missing tool ${name}`);
	}
	return tool;
}

describe("nklein retrieval tools", () => {
	it("returns a compact repo map", async () => {
		const workspacePath = await createWorkspace();
		const repoMapTool = getTool("repo_map", workspacePath);

		const result = (await repoMapTool.execute({ tokenBudget: 200 }, undefined as never)) as {
			map: string;
			filesScanned: number;
			symbolsReturned: number;
			truncated: boolean;
		};

		expect(result.filesScanned).toBe(2);
		expect(result.symbolsReturned).toBeGreaterThanOrEqual(2);
		expect(result.truncated).toBe(false);
		expect(result.map).toContain("alphaFeature");
		expect(result.map).toContain("src/index.ts");
	});

	it("returns focused code search snippets", async () => {
		const workspacePath = await createWorkspace();
		const searchTool = getTool("search_code", workspacePath);

		const result = (await searchTool.execute(
			{ query: "betaFeature", maxResults: 2, contextLines: 1 },
			undefined as never,
		)) as {
			filesScanned: number;
			matches: Array<{ path: string; snippet: string; lineStart: number; lineEnd: number }>;
			truncated: boolean;
		};

		expect(result.filesScanned).toBe(2);
		expect(result.matches.length).toBeGreaterThan(0);
		expect(result.matches[0]?.path).toBe("src/index.ts");
		expect(result.matches[0]?.snippet).toContain("betaFeature");
		expect(result.matches[0]?.lineStart).toBeGreaterThan(0);
		expect(result.matches[0]?.lineEnd).toBeGreaterThanOrEqual(result.matches[0]?.lineStart ?? 0);
	});

	it("merges repo-map and indexed chunk search when line search misses", async () => {
		const workspacePath = await createWorkspace();
		const searchTool = getTool("search_code", workspacePath);

		const result = (await searchTool.execute(
			{ query: "storage-adapter", maxResults: 2, contextLines: 1 },
			undefined as never,
		)) as {
			filesScanned: number;
			matches: Array<{ path: string; snippet: string; lineStart: number; lineEnd: number }>;
			truncated: boolean;
		};

		expect(result.filesScanned).toBe(2);
		expect(result.matches[0]?.path).toBe("src/storage-adapter.ts");
		expect(result.matches[0]?.snippet).toContain("createDriver");
		expect(result.matches[0]?.snippet).toContain("refs=");
	});

	it("hands each search_code turn to the recordRetrieval sink (query + hits + cited paths)", async () => {
		const workspacePath = await createWorkspace();
		const records: Array<{ query: string; hitsConsidered: number; citations: readonly string[] }> = [];
		const searchTool = createNKleinRetrievalTools({
			workspacePath,
			recordRetrieval: (record) => records.push(record),
		}).find((candidate) => candidate.name === "search_code");
		if (!searchTool) {
			throw new Error("Missing search_code tool");
		}

		const result = (await searchTool.execute({ query: "betaFeature", maxResults: 2 }, undefined as never)) as {
			matches: Array<{ path: string }>;
		};

		expect(records).toHaveLength(1);
		expect(records[0]?.query).toBe("betaFeature");
		// hitsConsidered mirrors the returned matches; citations are their source paths.
		expect(records[0]?.hitsConsidered).toBe(result.matches.length);
		expect(records[0]?.citations).toEqual(result.matches.map((match) => match.path));
	});

	it("reranks and prunes bounded code hits before returning them, with honest telemetry", async () => {
		const workspacePath = await createWorkspace();
		const records: Array<{ hitsConsidered: number; citations: readonly string[]; pruned?: number }> = [];
		const seen: Array<{ taskContext: string; searchQuery: string; count: number }> = [];
		const searchTool = createNKleinRetrievalTools({
			workspacePath,
			taskContext: "Implement the relevant feature, not a parallel adapter.",
			discriminateRetrieval: async (input) => {
				seen.push({
					taskContext: input.taskContext,
					searchQuery: input.searchQuery,
					count: input.candidates.length,
				});
				const rankedIds = input.candidates.map((candidate) => candidate.id).reverse();
				return { rankedIds, keepIds: rankedIds.slice(0, 1) };
			},
			recordRetrieval: (record) => records.push(record),
		}).find((candidate) => candidate.name === "search_code");
		if (!searchTool) throw new Error("Missing search_code tool");

		const result = (await searchTool.execute({ query: "function", maxResults: 8 }, undefined as never)) as {
			matches: Array<{ path: string }>;
			rerank: { applied: boolean; considered: number; kept: number; pruned: number };
		};

		expect(seen).toEqual([
			{
				taskContext: "Implement the relevant feature, not a parallel adapter.",
				searchQuery: "function",
				count: result.rerank.considered,
			},
		]);
		expect(result.rerank.applied).toBe(true);
		expect(result.rerank.kept).toBe(2);
		expect(result.rerank.pruned).toBeGreaterThan(0);
		expect(records[0]?.hitsConsidered).toBe(result.rerank.considered);
		expect(records[0]?.pruned).toBe(result.rerank.pruned);
		expect(records[0]?.citations).toEqual(result.matches.map((match) => match.path));
	});

	it("fails open to every original hit when the discriminator throws", async () => {
		const workspacePath = await createWorkspace();
		const searchTool = createNKleinRetrievalTools({
			workspacePath,
			discriminateRetrieval: async () => {
				throw new Error("model endpoint unavailable");
			},
		}).find((candidate) => candidate.name === "search_code");
		if (!searchTool) throw new Error("Missing search_code tool");

		const result = (await searchTool.execute({ query: "function", maxResults: 8 }, undefined as never)) as {
			matches: unknown[];
			rerank: { applied: boolean; considered: number; kept: number; pruned: number };
		};
		expect(result.rerank).toEqual({
			applied: false,
			considered: result.matches.length,
			kept: result.matches.length,
			pruned: 0,
		});
	});

	it("omitting recordRetrieval is safe (no sink, no throw)", async () => {
		const workspacePath = await createWorkspace();
		const searchTool = getTool("search_code", workspacePath);
		await expect(searchTool.execute({ query: "betaFeature" }, undefined as never)).resolves.toBeDefined();
	});
});

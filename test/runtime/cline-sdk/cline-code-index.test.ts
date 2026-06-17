import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { ClineCodeEmbeddingProvider } from "../../../src/cline-sdk/cline-code-embeddings";
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

	it("persists and reuses local chunk embedding vectors", async () => {
		const workspacePath = await createWorkspace();
		const cachePath = join(workspacePath, ".cline", "kanban", "code-index-test.json");

		const first = await searchClineCodeIndex({
			workspacePath,
			query: "storage persistence",
			maxResults: 2,
			chunkLines: 20,
			cachePath,
		});
		const second = await searchClineCodeIndex({
			workspacePath,
			query: "storage persistence",
			maxResults: 2,
			chunkLines: 20,
			cachePath,
		});

		expect(first.index.embeddingModel).toBe("kanban-local-lexical-vector-v1");
		expect(first.index.embeddingProvider).toBe("local_lexical");
		expect(first.index.cacheMissCount).toBeGreaterThan(0);
		expect(second.index.cacheHitCount).toBeGreaterThan(0);
		expect(JSON.parse(await readFile(cachePath, "utf8"))).toEqual(
			expect.objectContaining({
				embeddingProvider: "local_lexical",
				embeddingModel: "kanban-local-lexical-vector-v1",
			}),
		);
	});

	it("garbage-collects cached vectors for deleted chunks", async () => {
		const workspacePath = await createWorkspace();
		const cachePath = join(workspacePath, ".cline", "kanban", "code-index-gc-test.json");
		await searchClineCodeIndex({
			workspacePath,
			query: "storage persistence",
			chunkLines: 4,
			cachePath,
		});
		await writeFile(join(workspacePath, "src", "storage-adapter.ts"), "export const tiny = true;\n", "utf8");

		await searchClineCodeIndex({
			workspacePath,
			query: "tiny",
			chunkLines: 4,
			cachePath,
		});

		const parsed = JSON.parse(await readFile(cachePath, "utf8")) as {
			files: Array<{ chunks: unknown[] }>;
			embeddings: unknown[];
		};
		const currentChunkCount = parsed.files.reduce((total, file) => total + file.chunks.length, 0);
		expect(parsed.embeddings).toHaveLength(currentChunkCount);
	});

	it("separates cache entries by embedding provider cache key", async () => {
		const workspacePath = await createWorkspace();
		const cachePath = join(workspacePath, ".cline", "kanban", "code-index-provider-test.json");
		const provider: ClineCodeEmbeddingProvider = {
			kind: "openai_compatible",
			model: "test-embedding",
			cacheKey: "openai-compatible:test-embedding",
			async embed(text) {
				return new Map([
					["dim:0", text.includes("storage") ? 1 : 0],
					["dim:1", text.length],
				]);
			},
		};

		const first = await searchClineCodeIndex({
			workspacePath,
			query: "storage",
			chunkLines: 20,
			cachePath,
		});
		const second = await searchClineCodeIndex({
			workspacePath,
			query: "storage",
			chunkLines: 20,
			cachePath,
			embeddingProvider: provider,
		});

		expect(first.index.embeddingProvider).toBe("local_lexical");
		expect(second.index.embeddingProvider).toBe("openai_compatible");
		expect(second.index.cacheMissCount).toBeGreaterThan(0);
		expect(JSON.parse(await readFile(cachePath, "utf8"))).toEqual(
			expect.objectContaining({
				embeddingProvider: "openai_compatible",
				embeddingModel: "test-embedding",
				embeddingCacheKey: "openai-compatible:test-embedding",
			}),
		);
	});
});

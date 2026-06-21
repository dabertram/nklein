import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { NKleinCodeEmbeddingProvider } from "../../../src/nklein-sdk/nklein-code-embeddings";
import { getNKleinCodeIndexStatus, searchNKleinCodeIndex } from "../../../src/nklein-sdk/nklein-code-index";

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

async function waitForCondition(condition: () => boolean): Promise<void> {
	for (let attempt = 0; attempt < 20; attempt += 1) {
		if (condition()) {
			return;
		}
		await new Promise((resolve) => setTimeout(resolve, 0));
	}
	throw new Error("Condition was not met before timeout.");
}

function createDeferred(): { promise: Promise<void>; resolve: () => void } {
	let resolveDeferred: () => void = () => {};
	const promise = new Promise<void>((resolve) => {
		resolveDeferred = resolve;
	});
	return { promise, resolve: resolveDeferred };
}

describe("nklein code index", () => {
	it("returns offline chunk matches using path and token-vector similarity", async () => {
		const workspacePath = await createWorkspace();

		const result = await searchNKleinCodeIndex({
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
		const cachePath = join(workspacePath, ".nklein", "kanban", "code-index-test.json");

		const first = await searchNKleinCodeIndex({
			workspacePath,
			query: "storage persistence",
			maxResults: 2,
			chunkLines: 20,
			cachePath,
		});
		const second = await searchNKleinCodeIndex({
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

	it("reports active indexing progress while embeddings are being built", async () => {
		const workspacePath = await createWorkspace();
		let embedCalls = 0;
		const blockedEmbedding = createDeferred();
		const provider: NKleinCodeEmbeddingProvider = {
			kind: "local_lexical",
			model: "test-progress-provider",
			cacheKey: "local-progress:test",
			async embed(text) {
				embedCalls += 1;
				if (embedCalls === 2) {
					await blockedEmbedding.promise;
				}
				return new Map([["length", text.length]]);
			},
		};

		const searchPromise = searchNKleinCodeIndex({
			workspacePath,
			query: "storage persistence",
			chunkLines: 4,
			embeddingProvider: provider,
		});
		await waitForCondition(() => embedCalls >= 2);

		const active = await getNKleinCodeIndexStatus({ workspacePath, chunkLines: 4 });
		expect(active.progress.phase).toBe("embedding");
		expect(active.progress.filesTotal).toBe(1);
		expect(active.progress.filesProcessed).toBe(1);
		expect(active.progress.chunksTotal).toBeGreaterThan(1);
		expect(active.progress.chunksProcessed).toBe(0);

		blockedEmbedding.resolve();
		await searchPromise;
		const completed = await getNKleinCodeIndexStatus({ workspacePath, chunkLines: 4 });
		expect(completed.progress.phase).toBe("complete");
		expect(completed.progress.chunksProcessed).toBe(completed.progress.chunksTotal);
	});

	it("garbage-collects cached vectors for deleted chunks", async () => {
		const workspacePath = await createWorkspace();
		const cachePath = join(workspacePath, ".nklein", "kanban", "code-index-gc-test.json");
		await searchNKleinCodeIndex({
			workspacePath,
			query: "storage persistence",
			chunkLines: 4,
			cachePath,
		});
		await writeFile(join(workspacePath, "src", "storage-adapter.ts"), "export const tiny = true;\n", "utf8");

		await searchNKleinCodeIndex({
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

	it("reports indexed, missing, and stale source chunks from the persisted cache", async () => {
		const workspacePath = await createWorkspace();
		const cachePath = join(workspacePath, ".nklein", "kanban", "code-index-status-test.json");
		await searchNKleinCodeIndex({
			workspacePath,
			query: "storage persistence",
			chunkLines: 4,
			cachePath,
		});

		const indexed = await getNKleinCodeIndexStatus({ workspacePath, chunkLines: 4, cachePath });
		expect(indexed.cacheExists).toBe(true);
		expect(indexed.embeddingProvider).toBe("local_lexical");
		expect(indexed.embeddingModel).toBe("kanban-local-lexical-vector-v1");
		expect(indexed.totalFiles).toBe(1);
		expect(indexed.totalChunks).toBeGreaterThan(1);
		expect(indexed.indexedFiles).toBe(1);
		expect(indexed.indexedChunks).toBe(indexed.totalChunks);
		expect(indexed.missingFiles).toBe(0);
		expect(indexed.staleFiles).toBe(0);
		expect(indexed.searchAvailable).toBe(true);

		await writeFile(join(workspacePath, "src", "new-file.ts"), "export const newSymbol = true;\n", "utf8");
		await writeFile(join(workspacePath, "src", "storage-adapter.ts"), "export const changed = true;\n", "utf8");

		const stale = await getNKleinCodeIndexStatus({ workspacePath, chunkLines: 4, cachePath });
		expect(stale.totalFiles).toBe(2);
		expect(stale.indexedFiles).toBe(0);
		expect(stale.staleFiles).toBe(1);
		expect(stale.missingFiles).toBe(1);
		expect(stale.searchAvailable).toBe(false);
	});

	it("separates cache entries by embedding provider cache key", async () => {
		const workspacePath = await createWorkspace();
		const cachePath = join(workspacePath, ".nklein", "kanban", "code-index-provider-test.json");
		const provider: NKleinCodeEmbeddingProvider = {
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

		const first = await searchNKleinCodeIndex({
			workspacePath,
			query: "storage",
			chunkLines: 20,
			cachePath,
		});
		const second = await searchNKleinCodeIndex({
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

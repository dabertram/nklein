import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	type EmbeddingModelManifest,
	ensureEmbeddingModel,
	getEmbeddingModelPath,
	isEmbeddingModelInstalled,
} from "../../../src/nklein-agent/nklein-embedding-model-manager";

const MANIFEST: EmbeddingModelManifest = {
	id: "test-embed",
	version: "1",
	label: "Test Embed",
	fileName: "test-embed.gguf",
	url: "https://example.invalid/test-embed.gguf",
	minBytes: 4,
	dimension: 8,
};

function okResponse(body: string): typeof fetch {
	return (async () =>
		new Response(body, {
			status: 200,
			headers: { "content-length": String(Buffer.byteLength(body)) },
		})) as unknown as typeof fetch;
}

describe("embedding model manager", () => {
	let rootDir: string;

	beforeEach(async () => {
		rootDir = await mkdtemp(join(tmpdir(), "nklein-embed-models-"));
	});
	afterEach(async () => {
		await rm(rootDir, { force: true, recursive: true });
	});

	it("reports not installed before any download", async () => {
		expect(await isEmbeddingModelInstalled(MANIFEST, { rootDir })).toBe(false);
	});

	it("streams the model to disk, writes the version marker, and is idempotent", async () => {
		let calls = 0;
		const fetchImpl = (async () => {
			calls += 1;
			return new Response("GGUF-CONTENT", { status: 200, headers: { "content-length": "12" } });
		}) as unknown as typeof fetch;

		const first = await ensureEmbeddingModel(MANIFEST, { rootDir, fetchImpl });
		expect(first.downloaded).toBe(true);
		expect(first.alreadyCurrent).toBe(false);
		expect(first.modelPath).toBe(getEmbeddingModelPath(MANIFEST, { rootDir }));
		expect(await readFile(first.modelPath, "utf8")).toBe("GGUF-CONTENT");
		expect(await isEmbeddingModelInstalled(MANIFEST, { rootDir })).toBe(true);

		const second = await ensureEmbeddingModel(MANIFEST, { rootDir, fetchImpl });
		expect(second.alreadyCurrent).toBe(true);
		expect(second.downloaded).toBe(false);
		expect(calls).toBe(1); // the current install was reused, not re-downloaded
	});

	it("reports download progress", async () => {
		const progress: Array<{ downloadedBytes: number; totalBytes: number | null }> = [];
		await ensureEmbeddingModel(MANIFEST, {
			rootDir,
			fetchImpl: okResponse("abcdefgh"),
			onProgress: (event) => progress.push(event),
		});
		expect(progress.length).toBeGreaterThan(0);
		expect(progress.at(-1)?.downloadedBytes).toBe(8);
		expect(progress.at(-1)?.totalBytes).toBe(8);
	});

	it("rejects and discards a file smaller than minBytes", async () => {
		await expect(
			ensureEmbeddingModel({ ...MANIFEST, minBytes: 1_000_000 }, { rootDir, fetchImpl: okResponse("tiny") }),
		).rejects.toThrow(/smaller than expected/);
		expect(await isEmbeddingModelInstalled(MANIFEST, { rootDir })).toBe(false);
	});

	it("re-provisions when the installed version no longer matches", async () => {
		await ensureEmbeddingModel(MANIFEST, { rootDir, fetchImpl: okResponse("v1-bytes") });
		expect(await isEmbeddingModelInstalled({ ...MANIFEST, version: "2" }, { rootDir })).toBe(false);
		const upgraded = await ensureEmbeddingModel(
			{ ...MANIFEST, version: "2" },
			{ rootDir, fetchImpl: okResponse("v2-longer-bytes") },
		);
		expect(upgraded.downloaded).toBe(true);
		expect(await readFile(upgraded.modelPath, "utf8")).toBe("v2-longer-bytes");
	});

	it("throws on a non-OK download response", async () => {
		const fetchImpl = (async () => new Response("nope", { status: 404 })) as unknown as typeof fetch;
		await expect(ensureEmbeddingModel(MANIFEST, { rootDir, fetchImpl })).rejects.toThrow(/HTTP 404/);
	});

	it("does not leave a .partial file after a successful download", async () => {
		const result = await ensureEmbeddingModel(MANIFEST, { rootDir, fetchImpl: okResponse("clean-bytes") });
		await expect(readFile(`${result.modelPath}.partial`, "utf8")).rejects.toThrow();
		// Sanity: writing the partial path ourselves then re-ensuring stays current and ignores it.
		await writeFile(`${result.modelPath}.partial`, "stale", "utf8");
		expect((await ensureEmbeddingModel(MANIFEST, { rootDir, fetchImpl: okResponse("x") })).alreadyCurrent).toBe(true);
	});
});

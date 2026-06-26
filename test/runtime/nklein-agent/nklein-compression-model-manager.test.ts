import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	type CompressionModelManifest,
	ensureCompressionModel,
	isCompressionModelInstalled,
} from "../../../src/nklein-agent/nklein-compression-model-manager";

const MANIFEST: CompressionModelManifest = {
	id: "test-compressor",
	version: "1",
	files: [
		{ name: "model.onnx", url: "https://example.test/model.onnx", minBytes: 4 },
		{ name: "tokenizer.json", url: "https://example.test/tokenizer.json", minBytes: 2 },
	],
};

function okResponse(bytes: number): Response {
	return new Response(new Uint8Array(bytes).fill(65), { status: 200 });
}

describe("compression model manager", () => {
	let rootDir: string;

	beforeEach(async () => {
		rootDir = await mkdtemp(join(tmpdir(), "nklein-compression-model-"));
	});

	afterEach(async () => {
		await rm(rootDir, { force: true, recursive: true });
	});

	it("downloads model files on first ensure and is idempotent afterwards", async () => {
		const fetchImpl = vi.fn(async () => okResponse(16));
		expect(await isCompressionModelInstalled(MANIFEST, { rootDir })).toBe(false);

		const first = await ensureCompressionModel(MANIFEST, {
			rootDir,
			fetchImpl: fetchImpl as unknown as typeof fetch,
		});
		expect(first.downloadedFiles).toEqual(["model.onnx", "tokenizer.json"]);
		expect(first.alreadyCurrent).toBe(false);
		expect(await isCompressionModelInstalled(MANIFEST, { rootDir })).toBe(true);
		await expect(readFile(join(rootDir, "test-compressor", "model.onnx"))).resolves.toBeTruthy();

		const second = await ensureCompressionModel(MANIFEST, {
			rootDir,
			fetchImpl: fetchImpl as unknown as typeof fetch,
		});
		expect(second.alreadyCurrent).toBe(true);
		expect(second.downloadedFiles).toEqual([]);
		// Only the first ensure performed network calls.
		expect(fetchImpl).toHaveBeenCalledTimes(2);
	});

	it("re-provisions when the version changes", async () => {
		const fetchImpl = vi.fn(async () => okResponse(16));
		await ensureCompressionModel(MANIFEST, { rootDir, fetchImpl: fetchImpl as unknown as typeof fetch });
		const bumped = { ...MANIFEST, version: "2" };
		expect(await isCompressionModelInstalled(bumped, { rootDir })).toBe(false);
		const result = await ensureCompressionModel(bumped, { rootDir, fetchImpl: fetchImpl as unknown as typeof fetch });
		expect(result.alreadyCurrent).toBe(false);
		expect(result.downloadedFiles).toHaveLength(2);
	});

	it("throws on a failed download and on a too-small file", async () => {
		await expect(
			ensureCompressionModel(MANIFEST, {
				rootDir,
				fetchImpl: (async () => new Response("nope", { status: 404 })) as unknown as typeof fetch,
			}),
		).rejects.toThrow(/Failed to download/);

		await expect(
			ensureCompressionModel(MANIFEST, {
				rootDir,
				fetchImpl: (async () => okResponse(1)) as unknown as typeof fetch,
			}),
		).rejects.toThrow(/smaller than expected/);
	});

	it("treats a partially-written install as not installed", async () => {
		const fetchImpl = vi.fn(async () => okResponse(16));
		await ensureCompressionModel(MANIFEST, { rootDir, fetchImpl: fetchImpl as unknown as typeof fetch });
		await writeFile(join(rootDir, "test-compressor", "model.onnx"), ""); // truncate below minBytes
		expect(await isCompressionModelInstalled(MANIFEST, { rootDir })).toBe(false);
	});
});

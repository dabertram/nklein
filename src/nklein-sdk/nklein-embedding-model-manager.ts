import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { resolveNkleinRuntimeHomePath } from "../config/runtime-paths";

/**
 * Runtime download/cache manager for the built-in, zero-config code-embedding GGUF (todo.md §5.I-1).
 *
 * "Batteries included": the first time a project needs semantic code indexing, !Klein fetches one quantized
 * GGUF embedding model to the runtime home and serves it in-process via the Python core (no LM Studio/Ollama).
 * This is the one sanctioned network fetch — it is explicit and visible (progress is surfaced in the
 * code-intelligence panel), host-side trusted control-plane, and never triggered inside a sandboxed agent run.
 *
 * The file is streamed to disk (a GGUF is tens-to-hundreds of MB; never buffer it in memory) via a `.partial`
 * then atomically renamed, so an interrupted download is discarded rather than served half-written. Network/IO
 * is injectable so the logic is unit-tested without a real multi-hundred-MB download.
 */

export interface EmbeddingModelManifest {
	/** Stable id; also the subdirectory under the cache root. */
	id: string;
	/** Bumped when the file/url changes; a mismatch re-provisions. */
	version: string;
	/** Human label for the code-intelligence panel. */
	label: string;
	/** Filename written under the model directory (the value passed to the Python core as `gguf_path`). */
	fileName: string;
	url: string;
	/** Optional sha256 for integrity verification. */
	sha256?: string;
	/** Minimum expected size in bytes (cheap sanity check when no hash is provided). */
	minBytes?: number;
	/** Embedding vector dimension the model produces (for index bookkeeping). */
	dimension: number;
}

/**
 * Default embedding model: nomic-embed-text-v1.5 (Q4_K_M GGUF, ~84MB) — small, code-capable, 8k context.
 * Chosen as the zero-config default; the user can override. URL points at the public GGUF conversion.
 */
export const DEFAULT_EMBEDDING_MODEL_MANIFEST: EmbeddingModelManifest = {
	id: "nomic-embed-text-v1.5",
	version: "1",
	label: "Nomic Embed Text v1.5 (Q4_K_M)",
	fileName: "nomic-embed-text-v1.5.Q4_K_M.gguf",
	url: "https://huggingface.co/nomic-ai/nomic-embed-text-v1.5-GGUF/resolve/main/nomic-embed-text-v1.5.Q4_K_M.gguf",
	minBytes: 50_000_000,
	dimension: 768,
};

const VERSION_MARKER = ".version";

export interface EmbeddingModelManagerOptions {
	rootDir?: string;
	fetchImpl?: typeof fetch;
	/** Progress callback for the code-intelligence panel: receives bytes downloaded and total (if known). */
	onProgress?: (progress: { downloadedBytes: number; totalBytes: number | null }) => void;
}

function resolveRootDir(options?: EmbeddingModelManagerOptions): string {
	return options?.rootDir ?? join(resolveNkleinRuntimeHomePath(homedir()), "embedding-models");
}

function modelDir(manifest: EmbeddingModelManifest, options?: EmbeddingModelManagerOptions): string {
	return join(resolveRootDir(options), manifest.id);
}

/** Absolute path of the cached GGUF file (whether or not it is present yet). */
export function getEmbeddingModelPath(
	manifest: EmbeddingModelManifest = DEFAULT_EMBEDDING_MODEL_MANIFEST,
	options?: EmbeddingModelManagerOptions,
): string {
	return join(modelDir(manifest, options), manifest.fileName);
}

async function fileExistsWithMinSize(path: string, minBytes?: number): Promise<boolean> {
	try {
		const info = await stat(path);
		return info.isFile() && info.size >= (minBytes ?? 1);
	} catch {
		return false;
	}
}

async function readInstalledVersion(dir: string): Promise<string | null> {
	try {
		return (await readFile(join(dir, VERSION_MARKER), "utf8")).trim() || null;
	} catch {
		return null;
	}
}

export async function isEmbeddingModelInstalled(
	manifest: EmbeddingModelManifest = DEFAULT_EMBEDDING_MODEL_MANIFEST,
	options?: EmbeddingModelManagerOptions,
): Promise<boolean> {
	const dir = modelDir(manifest, options);
	if ((await readInstalledVersion(dir)) !== manifest.version) {
		return false;
	}
	return fileExistsWithMinSize(join(dir, manifest.fileName), manifest.minBytes);
}

export interface EnsureEmbeddingModelResult {
	installed: boolean;
	modelPath: string;
	downloaded: boolean;
	alreadyCurrent: boolean;
	sizeBytes: number;
}

/**
 * Ensures the embedding GGUF is present and current, streaming the download if missing/outdated. Idempotent:
 * a current install is a no-op. Throws on download/integrity failure so the caller can fall back to lexical.
 */
export async function ensureEmbeddingModel(
	manifest: EmbeddingModelManifest = DEFAULT_EMBEDDING_MODEL_MANIFEST,
	options?: EmbeddingModelManagerOptions,
): Promise<EnsureEmbeddingModelResult> {
	const dir = modelDir(manifest, options);
	const finalPath = join(dir, manifest.fileName);
	if (await isEmbeddingModelInstalled(manifest, options)) {
		const info = await stat(finalPath);
		return { installed: true, modelPath: finalPath, downloaded: false, alreadyCurrent: true, sizeBytes: info.size };
	}
	const fetchImpl = options?.fetchImpl ?? fetch;
	// Version changed or file missing/short: re-provision cleanly.
	await rm(dir, { force: true, recursive: true }).catch(() => undefined);
	await mkdir(dir, { recursive: true });
	const partialPath = `${finalPath}.partial`;

	const response = await fetchImpl(manifest.url);
	if (!response.ok || !response.body) {
		throw new Error(`Failed to download embedding model ${manifest.fileName}: HTTP ${response.status}`);
	}
	const totalBytes = Number.parseInt(response.headers.get("content-length") ?? "", 10);
	const hash = createHash("sha256");
	let downloadedBytes = 0;
	const source = Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]);
	source.on("data", (chunk: Buffer) => {
		downloadedBytes += chunk.byteLength;
		hash.update(chunk);
		options?.onProgress?.({ downloadedBytes, totalBytes: Number.isFinite(totalBytes) ? totalBytes : null });
	});
	await pipeline(source, createWriteStream(partialPath));

	if (manifest.minBytes && downloadedBytes < manifest.minBytes) {
		await rm(partialPath, { force: true }).catch(() => undefined);
		throw new Error(`Embedding model ${manifest.fileName} is smaller than expected (${downloadedBytes} bytes).`);
	}
	if (manifest.sha256 && hash.digest("hex") !== manifest.sha256.toLowerCase()) {
		await rm(partialPath, { force: true }).catch(() => undefined);
		throw new Error(`Integrity check failed for embedding model ${manifest.fileName}.`);
	}
	await rename(partialPath, finalPath);
	await writeFile(join(dir, VERSION_MARKER), manifest.version, "utf8");
	return {
		installed: true,
		modelPath: finalPath,
		downloaded: true,
		alreadyCurrent: false,
		sizeBytes: downloadedBytes,
	};
}

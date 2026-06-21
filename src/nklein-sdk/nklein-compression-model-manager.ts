import { createHash } from "node:crypto";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { resolveNkleinRuntimeHomePath } from "../config/runtime-paths";

/**
 * Runtime download/update manager for the opt-in ONNX prompt-compression model (LLMLingua-2 XLM-RoBERTa).
 *
 * "Batteries included": when the user opts into model-backed compression, !Klein fetches the model + tokenizer
 * to the runtime home on first use and keeps them updated by version, so nothing has to be installed manually.
 * When the user opts out (the default on limited hardware), this is never called and the heuristic scorer is
 * used instead. Network/IO is injectable so the logic is unit-tested without real downloads.
 *
 * NOTE: the onnxruntime inference adapter that *uses* these files is a separate seam (kept out of committed
 * code so the heavy native dependency is not forced); this manager only provisions the files.
 */

export interface CompressionModelFile {
	/** Filename written under the model directory. */
	name: string;
	url: string;
	/** Optional sha256 for integrity verification. */
	sha256?: string;
	/** Minimum expected size in bytes (cheap sanity check when no hash is provided). */
	minBytes?: number;
}

export interface CompressionModelManifest {
	id: string;
	version: string;
	files: CompressionModelFile[];
}

/** Default manifest for the LLMLingua-2 compressor (ONNX). URLs are placeholders resolved at opt-in time. */
export const DEFAULT_COMPRESSION_MODEL_MANIFEST: CompressionModelManifest = {
	id: "llmlingua2-xlm-roberta",
	version: "1",
	files: [
		{
			name: "model.onnx",
			url: "https://huggingface.co/microsoft/llmlingua-2-xlm-roberta-large-meetingbank/resolve/main/onnx/model.onnx",
			minBytes: 1_000_000,
		},
		{
			name: "tokenizer.json",
			url: "https://huggingface.co/microsoft/llmlingua-2-xlm-roberta-large-meetingbank/resolve/main/tokenizer.json",
			minBytes: 1_000,
		},
	],
};

const VERSION_MARKER = ".version";

export interface CompressionModelManagerOptions {
	rootDir?: string;
	fetchImpl?: typeof fetch;
}

function resolveRootDir(options?: CompressionModelManagerOptions): string {
	return options?.rootDir ?? join(resolveNkleinRuntimeHomePath(homedir()), "compression-models");
}

function modelDir(manifest: CompressionModelManifest, options?: CompressionModelManagerOptions): string {
	return join(resolveRootDir(options), manifest.id);
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

export async function isCompressionModelInstalled(
	manifest: CompressionModelManifest = DEFAULT_COMPRESSION_MODEL_MANIFEST,
	options?: CompressionModelManagerOptions,
): Promise<boolean> {
	const dir = modelDir(manifest, options);
	if ((await readInstalledVersion(dir)) !== manifest.version) {
		return false;
	}
	for (const file of manifest.files) {
		if (!(await fileExistsWithMinSize(join(dir, file.name), file.minBytes))) {
			return false;
		}
	}
	return true;
}

export interface EnsureCompressionModelResult {
	installed: boolean;
	modelDir: string;
	downloadedFiles: string[];
	alreadyCurrent: boolean;
}

function verifyHash(buffer: Buffer, expected?: string): boolean {
	if (!expected) {
		return true;
	}
	return createHash("sha256").update(buffer).digest("hex") === expected.toLowerCase();
}

/**
 * Ensures the model files are present and current, downloading any missing/outdated file. Idempotent: a
 * fully-current install is a no-op. Throws on download/integrity failure so the caller can fall back to the
 * heuristic scorer.
 */
export async function ensureCompressionModel(
	manifest: CompressionModelManifest = DEFAULT_COMPRESSION_MODEL_MANIFEST,
	options?: CompressionModelManagerOptions,
): Promise<EnsureCompressionModelResult> {
	const dir = modelDir(manifest, options);
	const fetchImpl = options?.fetchImpl ?? fetch;
	if (await isCompressionModelInstalled(manifest, options)) {
		return { installed: true, modelDir: dir, downloadedFiles: [], alreadyCurrent: true };
	}
	// Version changed or files missing: re-provision cleanly.
	await rm(dir, { force: true, recursive: true }).catch(() => undefined);
	await mkdir(dir, { recursive: true });
	const downloadedFiles: string[] = [];
	for (const file of manifest.files) {
		const response = await fetchImpl(file.url);
		if (!response.ok) {
			throw new Error(`Failed to download compression model file ${file.name}: HTTP ${response.status}`);
		}
		const buffer = Buffer.from(await response.arrayBuffer());
		if (!verifyHash(buffer, file.sha256)) {
			throw new Error(`Integrity check failed for compression model file ${file.name}.`);
		}
		if (file.minBytes && buffer.byteLength < file.minBytes) {
			throw new Error(`Compression model file ${file.name} is smaller than expected (${buffer.byteLength} bytes).`);
		}
		await writeFile(join(dir, file.name), buffer);
		downloadedFiles.push(file.name);
	}
	await writeFile(join(dir, VERSION_MARKER), manifest.version, "utf8");
	return { installed: true, modelDir: dir, downloadedFiles, alreadyCurrent: false };
}

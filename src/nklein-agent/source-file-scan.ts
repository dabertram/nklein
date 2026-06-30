import { readdir, stat } from "node:fs/promises";
import { extname, join } from "node:path";

/**
 * Shared source-file scanning for the repo tools (code search + code index), consolidated from their
 * byte-identical copies (§4A). repo-map keeps its own variant (it uses a custom extension reader and
 * an extra TS-AST extension set). Pure filesystem walk — no tool-specific state.
 */

/** Source file extensions the repo scanners index. */
export const SOURCE_EXTENSIONS = new Set([
	".ts",
	".tsx",
	".js",
	".jsx",
	".mjs",
	".cjs",
	".py",
	".go",
	".rs",
	".java",
	".kt",
	".swift",
	".rb",
	".php",
	".cs",
	".css",
]);

/** Directories the repo scanners never descend into. */
export const SKIPPED_DIRS = new Set([
	".git",
	".next",
	".turbo",
	".vite",
	"coverage",
	"dist",
	"node_modules",
	"out",
	"target",
	"tmp",
]);

/** Largest file (bytes) the scanners will include. */
export const MAX_FILE_BYTES = 512_000;

/** True when a file name's (lowercased) extension is a scanned source extension. */
export function shouldScanFile(fileName: string): boolean {
	return SOURCE_EXTENSIONS.has(extname(fileName).toLowerCase());
}

/** Recursively collect scannable source files under `rootPath` (skipping {@link SKIPPED_DIRS} and oversized files), capped at `maxFiles`. */
export async function listSourceFiles(rootPath: string, maxFiles: number): Promise<string[]> {
	const results: string[] = [];
	async function visit(directoryPath: string): Promise<void> {
		if (results.length >= maxFiles) {
			return;
		}
		const entries = await readdir(directoryPath, { withFileTypes: true });
		for (const entry of entries) {
			if (results.length >= maxFiles) {
				return;
			}
			const entryPath = join(directoryPath, entry.name);
			if (entry.isDirectory()) {
				if (!SKIPPED_DIRS.has(entry.name)) {
					await visit(entryPath);
				}
				continue;
			}
			if (!entry.isFile() || !shouldScanFile(entry.name)) {
				continue;
			}
			const fileStat = await stat(entryPath);
			if (fileStat.size <= MAX_FILE_BYTES) {
				results.push(entryPath);
			}
		}
	}
	await visit(rootPath);
	return results;
}

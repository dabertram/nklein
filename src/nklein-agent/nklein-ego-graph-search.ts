/**
 * F11.2c workspace assembly for the ego-graph localizer: parse every scanned source file into `EgoFileFacts`
 * (reusing the repo map's TS-AST fact extractor) and resolve RELATIVE import specifiers against the scanned path
 * set — pure two-phase assembly (`assembleEgoFileFacts`, string-testable) with a thin fs wrapper
 * (`searchEgoGraph`) mirroring `searchAstShapes`. Bare package specifiers are skipped honestly: the neighborhood
 * is the WORKSPACE graph, not node_modules.
 */

import { readFile } from "node:fs/promises";
import { relative } from "node:path";
import { buildSymbolEgoGraph, type EgoFileFacts, type EgoGraphOptions, type EgoGraphResult } from "../core/ego-graph";
import { extractAstSourceFacts } from "./nklein-repo-map-ast";
import { listSourceFiles } from "./source-file-scan";

const TS_EXTENSIONS = /\.(ts|tsx|js|jsx|mts|cts|mjs|cjs)$/i;
const RESOLUTION_SUFFIXES = ["", ".ts", ".tsx", ".js", ".jsx", ".mts", ".cts", "/index.ts", "/index.tsx", "/index.js"];

/** Collapse `a/b/../c` and `./` segments without touching the filesystem (workspace-relative, POSIX separators). */
function normalizeRelativePath(path: string): string {
	const segments: string[] = [];
	for (const segment of path.split("/")) {
		if (segment === "" || segment === ".") {
			continue;
		}
		if (segment === "..") {
			segments.pop();
			continue;
		}
		segments.push(segment);
	}
	return segments.join("/");
}

/** Resolve a `./x`-style specifier from `fromPath` against the scanned path set; null for bare/unresolvable ones. */
function resolveRelativeImport(fromPath: string, specifier: string, knownPaths: ReadonlySet<string>): string | null {
	if (!specifier.startsWith("./") && !specifier.startsWith("../")) {
		return null;
	}
	const fromDir = fromPath.includes("/") ? fromPath.slice(0, fromPath.lastIndexOf("/")) : "";
	const base = normalizeRelativePath(`${fromDir}/${specifier}`);
	for (const suffix of RESOLUTION_SUFFIXES) {
		// TS-style `./x.js` specifiers point at `./x.ts` on disk — try the swapped extension too.
		for (const candidate of [
			`${base}${suffix}`,
			suffix === "" && /\.(js|mjs|cjs)$/i.test(base) ? base.replace(/\.(js|mjs|cjs)$/i, ".ts") : null,
		]) {
			if (candidate && knownPaths.has(candidate)) {
				return candidate;
			}
		}
	}
	return null;
}

/** Parse scanned files into ego facts, resolving relative imports against the scanned path set. Pure. */
export function assembleEgoFileFacts(files: ReadonlyArray<{ path: string; content: string }>): EgoFileFacts[] {
	const knownPaths = new Set(files.map((file) => file.path));
	const assembled: EgoFileFacts[] = [];
	for (const file of files) {
		if (!TS_EXTENSIONS.test(file.path)) {
			continue;
		}
		try {
			const facts = extractAstSourceFacts(file.path, file.content);
			const importedPaths = [
				...new Set(
					facts.imports
						.map((entry) => resolveRelativeImport(file.path, entry.modulePath, knownPaths))
						.filter((path): path is string => path !== null && path !== file.path),
				),
			];
			assembled.push({
				path: file.path,
				symbols: facts.symbols.map((symbol) => ({ name: symbol.name, kind: symbol.kind, line: symbol.line })),
				referencedIdentifiers: facts.identifiers,
				importedPaths,
			});
		} catch {
			// A single unparseable file never sinks the localization.
		}
	}
	return assembled;
}

export interface EgoGraphSearchResult extends EgoGraphResult {
	readonly filesScanned: number;
}

/** Scan the workspace, assemble the fact graph, and localize the seeds' k-hop neighborhood. */
export async function searchEgoGraph(
	options: {
		workspacePath: string;
		seeds: readonly string[];
		maxFiles?: number;
	} & EgoGraphOptions,
): Promise<EgoGraphSearchResult> {
	const filePaths = await listSourceFiles(options.workspacePath, options.maxFiles ?? 400);
	const files: Array<{ path: string; content: string }> = [];
	for (const filePath of filePaths) {
		const path = relative(options.workspacePath, filePath);
		if (!TS_EXTENSIONS.test(path)) {
			continue;
		}
		try {
			files.push({ path, content: await readFile(filePath, "utf8") });
		} catch {
			// Unreadable file — skip.
		}
	}
	const result = buildSymbolEgoGraph(options.seeds, assembleEgoFileFacts(files), {
		...(options.k !== undefined ? { k: options.k } : {}),
		...(options.maxTargets !== undefined ? { maxTargets: options.maxTargets } : {}),
	});
	return { ...result, filesScanned: files.length };
}

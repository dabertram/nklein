import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import { countKanbanTextTokens } from "./cline-context-budgets";

const DEFAULT_MAX_FILES = 1_000;
const DEFAULT_TOKEN_BUDGET = 1_200;
const MAX_REFERENCE_RANK_SYMBOLS = 500;
const SOURCE_EXTENSIONS = new Set([
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
const SKIPPED_DIRS = new Set([
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

export interface ClineRepoMapSymbol {
	name: string;
	kind: string;
	path: string;
	line: number;
	referenceCount: number;
}

export interface ClineRepoMap {
	workspacePath: string;
	filesScanned: number;
	symbols: ClineRepoMapSymbol[];
	rendered: string;
	tokenCount: number;
	truncated: boolean;
}

export interface BuildClineRepoMapOptions {
	workspacePath: string;
	tokenBudget?: number;
	maxFiles?: number;
}

interface SourceFile {
	path: string;
	content: string;
}

function getExtension(path: string): string {
	const index = path.lastIndexOf(".");
	return index >= 0 ? path.slice(index).toLowerCase() : "";
}

function shouldScanFile(path: string): boolean {
	return SOURCE_EXTENSIONS.has(getExtension(path));
}

async function listSourceFiles(rootPath: string, maxFiles: number): Promise<string[]> {
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
			if (fileStat.size <= 512_000) {
				results.push(entryPath);
			}
		}
	}
	await visit(rootPath);
	return results;
}

function extractSymbolsFromContent(path: string, content: string): ClineRepoMapSymbol[] {
	const symbols: ClineRepoMapSymbol[] = [];
	const patterns: Array<{ kind: string; pattern: RegExp }> = [
		{ kind: "function", pattern: /^\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\b/gm },
		{ kind: "class", pattern: /^\s*(?:export\s+)?class\s+([A-Za-z_$][\w$]*)\b/gm },
		{ kind: "interface", pattern: /^\s*(?:export\s+)?interface\s+([A-Za-z_$][\w$]*)\b/gm },
		{ kind: "type", pattern: /^\s*(?:export\s+)?type\s+([A-Za-z_$][\w$]*)\b/gm },
		{ kind: "const", pattern: /^\s*(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\b/gm },
		{ kind: "hook", pattern: /^\s*(?:export\s+)?function\s+(use[A-Z][A-Za-z0-9_$]*)\b/gm },
		{ kind: "python-function", pattern: /^\s*def\s+([A-Za-z_][\w]*)\b/gm },
		{ kind: "python-class", pattern: /^\s*class\s+([A-Za-z_][\w]*)\b/gm },
	];
	for (const { kind, pattern } of patterns) {
		for (const match of content.matchAll(pattern)) {
			const name = match[1];
			if (!name) {
				continue;
			}
			const line = content.slice(0, match.index ?? 0).split("\n").length;
			symbols.push({
				name,
				kind,
				path,
				line,
				referenceCount: 0,
			});
		}
	}
	return symbols;
}

function countReferences(symbolName: string, files: readonly SourceFile[]): number {
	const escaped = symbolName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const pattern = new RegExp(`\\b${escaped}\\b`, "g");
	return files.reduce((total, file) => total + Array.from(file.content.matchAll(pattern)).length, 0);
}

function renderSymbols(
	symbols: readonly ClineRepoMapSymbol[],
	tokenBudget: number,
): {
	rendered: string;
	tokenCount: number;
	truncated: boolean;
} {
	const lines = [
		"Repo map:",
		...symbols.map((symbol) => `${symbol.path}:${symbol.line} ${symbol.kind} ${symbol.name}`),
	];
	const kept: string[] = [];
	let tokenCount = 0;
	for (const line of lines) {
		const nextText = [...kept, line].join("\n");
		const nextTokens = countKanbanTextTokens(nextText);
		if (nextTokens > tokenBudget && kept.length > 0) {
			return {
				rendered: kept.join("\n"),
				tokenCount,
				truncated: true,
			};
		}
		kept.push(line);
		tokenCount = nextTokens;
	}
	return {
		rendered: kept.join("\n"),
		tokenCount,
		truncated: false,
	};
}

export async function buildClineRepoMap(options: BuildClineRepoMapOptions): Promise<ClineRepoMap> {
	const tokenBudget =
		typeof options.tokenBudget === "number" && Number.isFinite(options.tokenBudget) && options.tokenBudget > 0
			? Math.trunc(options.tokenBudget)
			: DEFAULT_TOKEN_BUDGET;
	const maxFiles =
		typeof options.maxFiles === "number" && Number.isFinite(options.maxFiles) && options.maxFiles > 0
			? Math.trunc(options.maxFiles)
			: DEFAULT_MAX_FILES;
	const filePaths = await listSourceFiles(options.workspacePath, maxFiles);
	const files: SourceFile[] = [];
	for (const filePath of filePaths) {
		files.push({
			path: relative(options.workspacePath, filePath),
			content: await readFile(filePath, "utf8"),
		});
	}
	const symbols = files.flatMap((file) => extractSymbolsFromContent(file.path, file.content));
	const referenceRankCandidates = symbols
		.sort((left, right) =>
			`${left.path}:${left.line}:${left.name}`.localeCompare(`${right.path}:${right.line}:${right.name}`),
		)
		.slice(0, MAX_REFERENCE_RANK_SYMBOLS);
	const rankedSymbols = referenceRankCandidates
		.map((symbol) => ({
			...symbol,
			referenceCount: countReferences(symbol.name, files),
		}))
		.sort((left, right) => {
			const referenceDelta = right.referenceCount - left.referenceCount;
			if (referenceDelta !== 0) {
				return referenceDelta;
			}
			return `${left.path}:${left.line}:${left.name}`.localeCompare(`${right.path}:${right.line}:${right.name}`);
		});
	const rendered = renderSymbols(rankedSymbols, tokenBudget);
	return {
		workspacePath: options.workspacePath,
		filesScanned: files.length,
		symbols: rankedSymbols,
		rendered: rendered.rendered,
		tokenCount: rendered.tokenCount,
		truncated: rendered.truncated,
	};
}

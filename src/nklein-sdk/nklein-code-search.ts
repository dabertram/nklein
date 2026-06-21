import { readdir, readFile, stat } from "node:fs/promises";
import { extname, join, relative } from "node:path";
import type { NKleinCodeEmbeddingProvider } from "./nklein-code-embeddings";
import { searchNKleinCodeIndex } from "./nklein-code-index";
import { buildNKleinRepoMap, type NKleinRepoMapSymbol } from "./nklein-repo-map";

const DEFAULT_MAX_FILES = 1_000;
const DEFAULT_MAX_RESULTS = 8;
const MAX_FILE_BYTES = 512_000;
const DEFAULT_CONTEXT_LINES = 3;
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

export interface NKleinCodeSearchMatch {
	path: string;
	lineStart: number;
	lineEnd: number;
	score: number;
	snippet: string;
}

export interface NKleinCodeSearchResult {
	query: string;
	filesScanned: number;
	matches: NKleinCodeSearchMatch[];
	truncated: boolean;
}

export interface SearchNKleinCodeOptions {
	workspacePath: string;
	query: string;
	maxFiles?: number;
	maxResults?: number;
	contextLines?: number;
	embeddingProvider?: NKleinCodeEmbeddingProvider;
}

interface SourceFile {
	path: string;
	content: string;
}

interface RankedNKleinCodeSearchMatch extends NKleinCodeSearchMatch {
	source: "lexical" | "repo_map" | "index";
}

function asPositiveInteger(value: number | undefined, fallback: number): number {
	return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.trunc(value) : fallback;
}

function normalizeQuery(query: string): string {
	return query.trim();
}

function tokenizeQuery(query: string): string[] {
	return Array.from(
		new Set(
			query
				.split(/[^A-Za-z0-9_$.-]+/g)
				.map((token) => token.trim())
				.filter((token) => token.length >= 2),
		),
	);
}

function shouldScanFile(fileName: string): boolean {
	return SOURCE_EXTENSIONS.has(extname(fileName).toLowerCase());
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
			if (fileStat.size <= MAX_FILE_BYTES) {
				results.push(entryPath);
			}
		}
	}
	await visit(rootPath);
	return results;
}

function scoreLine(line: string, query: string, queryTokens: readonly string[]): number {
	const lowerLine = line.toLowerCase();
	const lowerQuery = query.toLowerCase();
	let score = 0;
	if (lowerLine.includes(lowerQuery)) {
		score += 100 + lowerQuery.length;
	}
	for (const token of queryTokens) {
		const lowerToken = token.toLowerCase();
		if (!lowerLine.includes(lowerToken)) {
			continue;
		}
		score += token === query ? 30 : 10;
		if (new RegExp(`\\b${token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(line)) {
			score += 8;
		}
	}
	if (score > 0 && /^\s*(?:export\s+)?(?:async\s+)?(?:function|class|interface|type|const)\s+/.test(line)) {
		score += 8;
	}
	return score;
}

function buildSnippet(lines: readonly string[], matchLineIndex: number, contextLines: number): NKleinCodeSearchMatch {
	const startIndex = Math.max(0, matchLineIndex - contextLines);
	const endIndex = Math.min(lines.length - 1, matchLineIndex + contextLines);
	const snippetLines: string[] = [];
	for (let index = startIndex; index <= endIndex; index += 1) {
		const lineNumber = index + 1;
		snippetLines.push(`${lineNumber}: ${lines[index] ?? ""}`);
	}
	return {
		path: "",
		lineStart: startIndex + 1,
		lineEnd: endIndex + 1,
		score: 0,
		snippet: snippetLines.join("\n"),
	};
}

function searchFile(
	file: SourceFile,
	query: string,
	queryTokens: readonly string[],
	contextLines: number,
): NKleinCodeSearchMatch[] {
	const lines = file.content.split("\n");
	const matches: NKleinCodeSearchMatch[] = [];
	for (const [index, line] of lines.entries()) {
		const score = scoreLine(line, query, queryTokens);
		if (score <= 0) {
			continue;
		}
		const snippet = buildSnippet(lines, index, contextLines);
		matches.push({
			...snippet,
			path: file.path,
			score,
		});
	}
	return matches;
}

function scoreRepoMapSymbol(symbol: NKleinRepoMapSymbol, query: string, queryTokens: readonly string[]): number {
	const searchable = `${symbol.name} ${symbol.kind} ${symbol.path}`.toLowerCase();
	const lowerQuery = query.toLowerCase();
	let score = 0;
	if (searchable.includes(lowerQuery)) {
		score += 80 + lowerQuery.length;
	}
	for (const token of queryTokens) {
		if (searchable.includes(token.toLowerCase())) {
			score += token === query ? 40 : 18;
		}
	}
	if (score <= 0) {
		return 0;
	}
	return score + Math.round(symbol.rankScore * 100) + Math.min(symbol.referenceCount, 20);
}

function searchRepoMapSymbols(
	symbols: readonly NKleinRepoMapSymbol[],
	query: string,
	queryTokens: readonly string[],
): NKleinCodeSearchMatch[] {
	return symbols
		.map((symbol) => {
			const score = scoreRepoMapSymbol(symbol, query, queryTokens);
			if (score <= 0) {
				return null;
			}
			return {
				path: symbol.path,
				lineStart: symbol.line,
				lineEnd: symbol.line,
				score,
				snippet: `${symbol.line}: ${symbol.kind} ${symbol.name} refs=${symbol.referenceCount}`,
			} satisfies NKleinCodeSearchMatch;
		})
		.filter((match): match is NKleinCodeSearchMatch => match !== null);
}

function normalizeMatches(
	matches: readonly NKleinCodeSearchMatch[],
	source: RankedNKleinCodeSearchMatch["source"],
	weight: number,
): RankedNKleinCodeSearchMatch[] {
	const maxScore = Math.max(...matches.map((match) => match.score), 0);
	return matches.map((match) => ({
		...match,
		source,
		score: maxScore > 0 ? Math.round((match.score / maxScore) * weight) : 0,
	}));
}

function rankHybridMatches(input: {
	lexicalMatches: readonly NKleinCodeSearchMatch[];
	repoMapMatches: readonly NKleinCodeSearchMatch[];
	indexMatches: readonly NKleinCodeSearchMatch[];
	maxResults: number;
}): { matches: NKleinCodeSearchMatch[]; truncated: boolean } {
	const combined = [
		...normalizeMatches(input.lexicalMatches, "lexical", 100),
		...normalizeMatches(input.repoMapMatches, "repo_map", 90),
		...normalizeMatches(input.indexMatches, "index", 80),
	].filter((match) => match.score > 0);
	const bestByRange = new Map<string, RankedNKleinCodeSearchMatch>();
	for (const match of combined) {
		const key = `${match.path}:${match.lineStart}:${match.lineEnd}`;
		const existing = bestByRange.get(key);
		if (!existing || match.score > existing.score || (match.score === existing.score && match.source === "lexical")) {
			bestByRange.set(key, match);
		}
	}
	const ranked = [...bestByRange.values()].sort((left, right) => {
		const scoreDelta = right.score - left.score;
		if (scoreDelta !== 0) {
			return scoreDelta;
		}
		if (left.source !== right.source) {
			const priority = {
				lexical: 0,
				repo_map: 1,
				index: 2,
			} satisfies Record<RankedNKleinCodeSearchMatch["source"], number>;
			return priority[left.source] - priority[right.source];
		}
		return `${left.path}:${left.lineStart}`.localeCompare(`${right.path}:${right.lineStart}`);
	});
	return {
		matches: ranked.slice(0, input.maxResults).map(({ source: _source, ...match }) => match),
		truncated: ranked.length > input.maxResults,
	};
}

export async function searchNKleinCode(options: SearchNKleinCodeOptions): Promise<NKleinCodeSearchResult> {
	const query = normalizeQuery(options.query);
	if (!query) {
		throw new Error("Code search query cannot be empty.");
	}
	const queryTokens = tokenizeQuery(query);
	const maxFiles = asPositiveInteger(options.maxFiles, DEFAULT_MAX_FILES);
	const maxResults = asPositiveInteger(options.maxResults, DEFAULT_MAX_RESULTS);
	const contextLines = Math.min(asPositiveInteger(options.contextLines, DEFAULT_CONTEXT_LINES), 12);
	const filePaths = await listSourceFiles(options.workspacePath, maxFiles);
	const files: SourceFile[] = [];
	for (const filePath of filePaths) {
		files.push({
			path: relative(options.workspacePath, filePath),
			content: await readFile(filePath, "utf8"),
		});
	}
	const lexicalMatches = files
		.flatMap((file) => searchFile(file, query, queryTokens, contextLines))
		.sort((left, right) => {
			const scoreDelta = right.score - left.score;
			if (scoreDelta !== 0) {
				return scoreDelta;
			}
			return `${left.path}:${left.lineStart}`.localeCompare(`${right.path}:${right.lineStart}`);
		});
	const indexMatches = await searchNKleinCodeIndex({
		workspacePath: options.workspacePath,
		query,
		maxFiles,
		maxResults: Math.max(maxResults, DEFAULT_MAX_RESULTS),
		embeddingProvider: options.embeddingProvider,
	});
	const repoMap = await buildNKleinRepoMap({
		workspacePath: options.workspacePath,
		maxFiles,
		personalizationText: query,
	});
	const repoMapMatches = searchRepoMapSymbols(repoMap.symbols, query, queryTokens);
	const hybrid = rankHybridMatches({
		lexicalMatches,
		repoMapMatches,
		indexMatches: indexMatches.matches.map((match) => ({
			path: match.path,
			lineStart: match.lineStart,
			lineEnd: match.lineEnd,
			score: match.score,
			snippet: match.text,
		})),
		maxResults,
	});
	return {
		query,
		filesScanned: Math.max(files.length, indexMatches.filesScanned, repoMap.filesScanned),
		matches: hybrid.matches,
		truncated: hybrid.truncated || indexMatches.truncated || repoMap.truncated,
	};
}

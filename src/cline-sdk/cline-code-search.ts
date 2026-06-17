import { readdir, readFile, stat } from "node:fs/promises";
import { extname, join, relative } from "node:path";
import { searchClineCodeIndex } from "./cline-code-index";

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

export interface ClineCodeSearchMatch {
	path: string;
	lineStart: number;
	lineEnd: number;
	score: number;
	snippet: string;
}

export interface ClineCodeSearchResult {
	query: string;
	filesScanned: number;
	matches: ClineCodeSearchMatch[];
	truncated: boolean;
}

export interface SearchClineCodeOptions {
	workspacePath: string;
	query: string;
	maxFiles?: number;
	maxResults?: number;
	contextLines?: number;
}

interface SourceFile {
	path: string;
	content: string;
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

function buildSnippet(lines: readonly string[], matchLineIndex: number, contextLines: number): ClineCodeSearchMatch {
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
): ClineCodeSearchMatch[] {
	const lines = file.content.split("\n");
	const matches: ClineCodeSearchMatch[] = [];
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

export async function searchClineCode(options: SearchClineCodeOptions): Promise<ClineCodeSearchResult> {
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
	const rankedMatches = files
		.flatMap((file) => searchFile(file, query, queryTokens, contextLines))
		.sort((left, right) => {
			const scoreDelta = right.score - left.score;
			if (scoreDelta !== 0) {
				return scoreDelta;
			}
			return `${left.path}:${left.lineStart}`.localeCompare(`${right.path}:${right.lineStart}`);
		});
	if (rankedMatches.length === 0) {
		const indexMatches = await searchClineCodeIndex({
			workspacePath: options.workspacePath,
			query,
			maxFiles,
			maxResults,
		});
		return {
			query,
			filesScanned: indexMatches.filesScanned,
			matches: indexMatches.matches.map((match) => ({
				path: match.path,
				lineStart: match.lineStart,
				lineEnd: match.lineEnd,
				score: match.score,
				snippet: match.text,
			})),
			truncated: indexMatches.truncated,
		};
	}
	return {
		query,
		filesScanned: files.length,
		matches: rankedMatches.slice(0, maxResults),
		truncated: rankedMatches.length > maxResults,
	};
}

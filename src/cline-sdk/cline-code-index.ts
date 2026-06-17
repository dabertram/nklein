import { readdir, readFile, stat } from "node:fs/promises";
import { extname, join, relative } from "node:path";

const DEFAULT_MAX_FILES = 1_000;
const DEFAULT_MAX_RESULTS = 8;
const DEFAULT_CHUNK_LINES = 80;
const MAX_FILE_BYTES = 512_000;
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

export interface ClineCodeIndexChunk {
	path: string;
	lineStart: number;
	lineEnd: number;
	text: string;
}

export interface ClineCodeIndexSearchMatch extends ClineCodeIndexChunk {
	score: number;
}

export interface ClineCodeIndexSearchResult {
	query: string;
	filesScanned: number;
	matches: ClineCodeIndexSearchMatch[];
	truncated: boolean;
}

export interface SearchClineCodeIndexOptions {
	workspacePath: string;
	query: string;
	maxFiles?: number;
	maxResults?: number;
	chunkLines?: number;
}

interface SourceFile {
	path: string;
	content: string;
}

type SparseVector = Map<string, number>;

function asPositiveInteger(value: number | undefined, fallback: number): number {
	return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.trunc(value) : fallback;
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

function tokenize(text: string): string[] {
	return text
		.replace(/([a-z0-9])([A-Z])/g, "$1 $2")
		.toLowerCase()
		.split(/[^a-z0-9_$.-]+/g)
		.map((token) => token.trim())
		.filter((token) => token.length >= 2);
}

function vectorize(text: string): SparseVector {
	const vector: SparseVector = new Map();
	for (const token of tokenize(text)) {
		vector.set(token, (vector.get(token) ?? 0) + 1);
	}
	return vector;
}

function cosineSimilarity(left: SparseVector, right: SparseVector): number {
	let dot = 0;
	let leftMagnitude = 0;
	let rightMagnitude = 0;
	for (const value of left.values()) {
		leftMagnitude += value * value;
	}
	for (const value of right.values()) {
		rightMagnitude += value * value;
	}
	for (const [token, leftValue] of left) {
		dot += leftValue * (right.get(token) ?? 0);
	}
	if (leftMagnitude === 0 || rightMagnitude === 0) {
		return 0;
	}
	return dot / Math.sqrt(leftMagnitude * rightMagnitude);
}

function lexicalScore(chunkText: string, query: string): number {
	const lowerText = chunkText.toLowerCase();
	const lowerQuery = query.toLowerCase();
	let score = lowerText.includes(lowerQuery) ? 50 : 0;
	for (const token of new Set(tokenize(query))) {
		if (lowerText.includes(token)) {
			score += 8;
		}
	}
	return score;
}

function chunkFile(file: SourceFile, chunkLines: number): ClineCodeIndexChunk[] {
	const lines = file.content.split("\n");
	const chunks: ClineCodeIndexChunk[] = [];
	for (let startIndex = 0; startIndex < lines.length; startIndex += chunkLines) {
		const endIndex = Math.min(lines.length, startIndex + chunkLines);
		const text = lines
			.slice(startIndex, endIndex)
			.map((line, index) => `${startIndex + index + 1}: ${line}`)
			.join("\n");
		if (text.trim().length === 0) {
			continue;
		}
		chunks.push({
			path: file.path,
			lineStart: startIndex + 1,
			lineEnd: endIndex,
			text,
		});
	}
	return chunks;
}

export async function searchClineCodeIndex(options: SearchClineCodeIndexOptions): Promise<ClineCodeIndexSearchResult> {
	const query = options.query.trim();
	if (!query) {
		throw new Error("Code index query cannot be empty.");
	}
	const maxFiles = asPositiveInteger(options.maxFiles, DEFAULT_MAX_FILES);
	const maxResults = asPositiveInteger(options.maxResults, DEFAULT_MAX_RESULTS);
	const chunkLines = Math.min(asPositiveInteger(options.chunkLines, DEFAULT_CHUNK_LINES), 200);
	const filePaths = await listSourceFiles(options.workspacePath, maxFiles);
	const files: SourceFile[] = [];
	for (const filePath of filePaths) {
		files.push({
			path: relative(options.workspacePath, filePath),
			content: await readFile(filePath, "utf8"),
		});
	}

	const queryVector = vectorize(query);
	const rankedMatches = files
		.flatMap((file) => chunkFile(file, chunkLines))
		.map((chunk) => {
			const similarity = cosineSimilarity(queryVector, vectorize(`${chunk.path}\n${chunk.text}`));
			return {
				...chunk,
				score: Math.round(similarity * 100) + lexicalScore(`${chunk.path}\n${chunk.text}`, query),
			};
		})
		.filter((match) => match.score > 0)
		.sort((left, right) => {
			const scoreDelta = right.score - left.score;
			if (scoreDelta !== 0) {
				return scoreDelta;
			}
			return `${left.path}:${left.lineStart}`.localeCompare(`${right.path}:${right.lineStart}`);
		});

	return {
		query,
		filesScanned: files.length,
		matches: rankedMatches.slice(0, maxResults),
		truncated: rankedMatches.length > maxResults,
	};
}

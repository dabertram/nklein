import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, extname, join, relative } from "node:path";
import {
	type ClineCodeEmbeddingProvider,
	type ClineCodeEmbeddingVector,
	createClineCodeEmbeddingProvider,
} from "./cline-code-embeddings";

const DEFAULT_MAX_FILES = 1_000;
const DEFAULT_MAX_RESULTS = 8;
const DEFAULT_CHUNK_LINES = 80;
const MAX_FILE_BYTES = 512_000;
const CODE_INDEX_SCHEMA_VERSION = 1;
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
	index: {
		embeddingModel: string;
		embeddingProvider: string;
		cachePath: string | null;
		cacheHitCount: number;
		cacheMissCount: number;
	};
}

export interface SearchClineCodeIndexOptions {
	workspacePath: string;
	query: string;
	maxFiles?: number;
	maxResults?: number;
	chunkLines?: number;
	cachePath?: string | null;
	useCache?: boolean;
	embeddingProvider?: ClineCodeEmbeddingProvider;
}

interface SourceFile {
	path: string;
	content: string;
}

type SparseVector = ClineCodeEmbeddingVector;

interface CachedCodeIndexEntry {
	hash: string;
	vector: Array<[string, number]>;
}

interface CachedCodeIndexFile {
	path: string;
	size: number;
	mtimeMs: number;
	chunks: Array<{
		lineStart: number;
		lineEnd: number;
		hash: string;
	}>;
}

interface CachedCodeIndex {
	schemaVersion: number;
	embeddingProvider: string;
	embeddingModel: string;
	embeddingCacheKey: string;
	chunkLines: number;
	files: CachedCodeIndexFile[];
	embeddings: CachedCodeIndexEntry[];
	updatedAt: number;
}

interface VectorCache {
	cachePath: string | null;
	entries: Map<string, SparseVector>;
	hitCount: number;
	missCount: number;
}

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

function tokenizeForLexicalScore(text: string): string[] {
	return text
		.replace(/([a-z0-9])([A-Z])/g, "$1 $2")
		.toLowerCase()
		.split(/[^a-z0-9_$.-]+/g)
		.map((token) => token.trim())
		.filter((token) => token.length >= 2);
}

function vectorToEntries(vector: SparseVector): Array<[string, number]> {
	return [...vector.entries()].sort(([left], [right]) => left.localeCompare(right));
}

function entriesToVector(entries: Array<[string, number]>): SparseVector {
	return new Map(entries.filter(([token, value]) => token.trim().length > 0 && Number.isFinite(value)));
}

function hashText(text: string): string {
	return createHash("sha256").update(text).digest("hex");
}

function defaultCachePath(workspacePath: string): string {
	return join(workspacePath, ".cline", "kanban", "code-index-v1.json");
}

function isCachedCodeIndex(value: unknown): value is CachedCodeIndex {
	if (!value || typeof value !== "object") {
		return false;
	}
	const record = value as Record<string, unknown>;
	return (
		record.schemaVersion === CODE_INDEX_SCHEMA_VERSION &&
		typeof record.embeddingProvider === "string" &&
		typeof record.embeddingModel === "string" &&
		typeof record.embeddingCacheKey === "string" &&
		typeof record.chunkLines === "number" &&
		Array.isArray(record.files) &&
		Array.isArray(record.embeddings)
	);
}

async function loadVectorCache(options: {
	workspacePath: string;
	chunkLines: number;
	cachePath?: string | null;
	useCache: boolean;
	embeddingProvider: ClineCodeEmbeddingProvider;
}): Promise<VectorCache> {
	if (!options.useCache || options.cachePath === null) {
		return {
			cachePath: null,
			entries: new Map(),
			hitCount: 0,
			missCount: 0,
		};
	}
	const cachePath = options.cachePath ?? defaultCachePath(options.workspacePath);
	try {
		const parsed: unknown = JSON.parse(await readFile(cachePath, "utf8"));
		if (
			!isCachedCodeIndex(parsed) ||
			parsed.chunkLines !== options.chunkLines ||
			parsed.embeddingCacheKey !== options.embeddingProvider.cacheKey
		) {
			return {
				cachePath,
				entries: new Map(),
				hitCount: 0,
				missCount: 0,
			};
		}
		return {
			cachePath,
			entries: new Map(parsed.embeddings.map((entry) => [entry.hash, entriesToVector(entry.vector)])),
			hitCount: 0,
			missCount: 0,
		};
	} catch {
		return {
			cachePath,
			entries: new Map(),
			hitCount: 0,
			missCount: 0,
		};
	}
}

async function getCachedVector(
	cache: VectorCache,
	embeddingProvider: ClineCodeEmbeddingProvider,
	hash: string,
	text: string,
): Promise<SparseVector> {
	const cached = cache.entries.get(hash);
	if (cached) {
		cache.hitCount += 1;
		return cached;
	}
	cache.missCount += 1;
	const vector = await embeddingProvider.embed(text);
	cache.entries.set(hash, vector);
	return vector;
}

async function persistVectorCache(options: {
	cache: VectorCache;
	files: SourceFile[];
	chunksByFile: Map<string, ClineCodeIndexChunk[]>;
	chunkLines: number;
	workspacePath: string;
	embeddingProvider: ClineCodeEmbeddingProvider;
}): Promise<void> {
	if (!options.cache.cachePath) {
		return;
	}
	const files: CachedCodeIndexFile[] = [];
	const currentChunkHashes = new Set<string>();
	for (const file of options.files) {
		const absolutePath = join(options.workspacePath, file.path);
		const fileStat = await stat(absolutePath);
		const chunks = (options.chunksByFile.get(file.path) ?? []).map((chunk) => ({
			lineStart: chunk.lineStart,
			lineEnd: chunk.lineEnd,
			hash: hashText(`${chunk.path}\n${chunk.text}`),
		}));
		for (const chunk of chunks) {
			currentChunkHashes.add(chunk.hash);
		}
		files.push({
			path: file.path,
			size: fileStat.size,
			mtimeMs: fileStat.mtimeMs,
			chunks,
		});
	}
	const payload: CachedCodeIndex = {
		schemaVersion: CODE_INDEX_SCHEMA_VERSION,
		embeddingProvider: options.embeddingProvider.kind,
		embeddingModel: options.embeddingProvider.model,
		embeddingCacheKey: options.embeddingProvider.cacheKey,
		chunkLines: options.chunkLines,
		files,
		embeddings: [...options.cache.entries.entries()]
			.filter(([hash]) => currentChunkHashes.has(hash))
			.map(([hash, vector]) => ({ hash, vector: vectorToEntries(vector) }))
			.sort((left, right) => left.hash.localeCompare(right.hash)),
		updatedAt: Date.now(),
	};
	await mkdir(dirname(options.cache.cachePath), { recursive: true });
	await writeFile(options.cache.cachePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
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
	for (const token of new Set(tokenizeForLexicalScore(query))) {
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
	const embeddingProvider = options.embeddingProvider ?? createClineCodeEmbeddingProvider();
	const vectorCache = await loadVectorCache({
		workspacePath: options.workspacePath,
		chunkLines,
		cachePath: options.cachePath ?? undefined,
		useCache: options.useCache !== false,
		embeddingProvider,
	});
	const filePaths = await listSourceFiles(options.workspacePath, maxFiles);
	const files: SourceFile[] = [];
	for (const filePath of filePaths) {
		files.push({
			path: relative(options.workspacePath, filePath),
			content: await readFile(filePath, "utf8"),
		});
	}

	const queryVector = await embeddingProvider.embed(query);
	const chunksByFile = new Map<string, ClineCodeIndexChunk[]>();
	const chunks = files.flatMap((file) => {
		const fileChunks = chunkFile(file, chunkLines);
		chunksByFile.set(file.path, fileChunks);
		return fileChunks;
	});
	const scoredMatches: ClineCodeIndexSearchMatch[] = [];
	for (const chunk of chunks) {
		const vectorText = `${chunk.path}\n${chunk.text}`;
		const similarity = cosineSimilarity(
			queryVector,
			await getCachedVector(vectorCache, embeddingProvider, hashText(vectorText), vectorText),
		);
		scoredMatches.push({
			...chunk,
			score: Math.round(similarity * 100) + lexicalScore(`${chunk.path}\n${chunk.text}`, query),
		});
	}
	const rankedMatches = scoredMatches
		.filter((match) => match.score > 0)
		.sort((left, right) => {
			const scoreDelta = right.score - left.score;
			if (scoreDelta !== 0) {
				return scoreDelta;
			}
			return `${left.path}:${left.lineStart}`.localeCompare(`${right.path}:${right.lineStart}`);
		});
	await persistVectorCache({
		cache: vectorCache,
		files,
		chunksByFile,
		chunkLines,
		workspacePath: options.workspacePath,
		embeddingProvider,
	});

	return {
		query,
		filesScanned: files.length,
		matches: rankedMatches.slice(0, maxResults),
		truncated: rankedMatches.length > maxResults,
		index: {
			embeddingModel: embeddingProvider.model,
			embeddingProvider: embeddingProvider.kind,
			cachePath: vectorCache.cachePath,
			cacheHitCount: vectorCache.hitCount,
			cacheMissCount: vectorCache.missCount,
		},
	};
}

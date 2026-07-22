import { readdir, readFile, stat } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fnv1aContentHash } from "../core/merkle-file-tree";
import { countKanbanTextTokens } from "./nklein-context-budgets";
import { createSymbol, extractAstSourceFacts } from "./nklein-repo-map-ast";
import { addWeightedEdge, buildPersonalizationVector, calculatePageRank } from "./pagerank";
import { SKIPPED_DIRS } from "./source-file-scan";

const DEFAULT_MAX_FILES = 1_000;
const DEFAULT_TOKEN_BUDGET = 1_200;
const MAX_DISCOVERED_SOURCE_FILES = 20_000;
// Bound graph work only AFTER preserving task/file-personalized symbols. The previous implementation sliced the
// path-sorted declaration list first, which made every symbol after position 500 permanently undiscoverable.
const MAX_PAGERANK_SYMBOLS = 5_000;
const TYPESCRIPT_AST_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);
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
export interface NKleinRepoMapSymbol {
	name: string;
	kind: string;
	path: string;
	line: number;
	referenceCount: number;
	rankScore: number;
}

export interface NKleinRepoMap {
	workspacePath: string;
	filesScanned: number;
	symbols: NKleinRepoMapSymbol[];
	rendered: string;
	tokenCount: number;
	truncated: boolean;
}

export interface BuildNKleinRepoMapOptions {
	workspacePath: string;
	tokenBudget?: number;
	maxFiles?: number;
	personalizationText?: string;
	seedPaths?: string[];
	/**
	 * F12.67 Merkle-style incremental parse: a caller-owned cache of per-file extraction facts keyed by path. On a
	 * rebuild, files whose content hash is unchanged reuse their cached facts instead of re-running the (AST) parse —
	 * only changed files pay. The caller owns the Map's lifetime (per-session in the context-focus extension);
	 * omitted ⇒ byte-identical full-parse behavior.
	 */
	factsCache?: Map<string, RepoMapFactsCacheEntry>;
}

export interface RepoMapFactsCacheEntry {
	hash: string;
	facts: Pick<SourceFile, "identifiers" | "imports" | "symbols">;
}

interface SourceFile {
	path: string;
	identifiers: string[];
	imports: SourceImport[];
	symbols: NKleinRepoMapSymbol[];
}

interface SourceImport {
	modulePath: string;
	importedNames: string[];
	bindings?: Array<{ importedName: string; localName: string }>;
}

interface RepoMapPersonalization {
	identifierCounts: Map<string, number>;
	seedPaths: Set<string>;
}

function getExtension(path: string): string {
	const index = path.lastIndexOf(".");
	return index >= 0 ? path.slice(index).toLowerCase() : "";
}

function shouldScanFile(path: string): boolean {
	return SOURCE_EXTENSIONS.has(getExtension(path));
}

function shouldParseWithTypeScriptAst(path: string): boolean {
	return TYPESCRIPT_AST_EXTENSIONS.has(getExtension(path));
}

function repoMapFilePriority(
	rootPath: string,
	filePath: string,
	personalizationText: string,
	seedPaths: ReadonlySet<string>,
): number {
	const relativePath = normalizeRepoMapPath(relative(rootPath, filePath));
	if (seedPaths.has(relativePath) || personalizationText.includes(relativePath)) return 0;
	return /(?:^|\/)(?:__tests__|examples?|fixtures?|scripts?|tests?|vendor)(?:\/|$)|\.(?:spec|test)\.[^.]+$/iu.test(
		relativePath,
	)
		? 2
		: 1;
}

async function listSourceFiles(
	rootPath: string,
	maxFiles: number,
	personalizationText = "",
	seedPaths: readonly string[] = [],
): Promise<string[]> {
	const results: string[] = [];
	const discoveryLimit = Math.max(maxFiles, MAX_DISCOVERED_SOURCE_FILES);
	async function visit(directoryPath: string): Promise<void> {
		if (results.length >= discoveryLimit) {
			return;
		}
		const entries = await readdir(directoryPath, { withFileTypes: true });
		for (const entry of entries) {
			if (results.length >= discoveryLimit) {
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
	const normalizedSeeds = new Set(seedPaths.map(normalizeRepoMapPath));
	return results
		.sort((left, right) => {
			const priorityDelta =
				repoMapFilePriority(rootPath, left, personalizationText, normalizedSeeds) -
				repoMapFilePriority(rootPath, right, personalizationText, normalizedSeeds);
			return priorityDelta || relative(rootPath, left).localeCompare(relative(rootPath, right));
		})
		.slice(0, maxFiles);
}

function extractRegexSymbolsFromContent(path: string, content: string): NKleinRepoMapSymbol[] {
	const symbols: NKleinRepoMapSymbol[] = [];
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
			symbols.push(createSymbol(path, content, name, kind, match.index ?? 0));
		}
	}
	return symbols;
}

function extractSourceFacts(path: string, content: string): Pick<SourceFile, "identifiers" | "imports" | "symbols"> {
	if (shouldParseWithTypeScriptAst(path)) {
		return extractAstSourceFacts(path, content);
	}
	const identifiers = content.match(/\b[A-Za-z_$][\w$]*\b/g) ?? [];
	return {
		identifiers,
		imports: [],
		symbols: extractRegexSymbolsFromContent(path, content),
	};
}

function symbolKey(symbol: Pick<NKleinRepoMapSymbol, "line" | "name" | "path">): string {
	return `${symbol.path}:${symbol.line}:${symbol.name}`;
}

function normalizeRelativeModulePath(fromPath: string, modulePath: string): string | null {
	if (!modulePath.startsWith(".")) {
		return null;
	}
	return join(dirname(fromPath), modulePath).replace(/\\/g, "/").replace(/^\.\//, "");
}

function resolveImportTargetPath(
	fromPath: string,
	modulePath: string,
	filePathSet: ReadonlySet<string>,
): string | null {
	const normalized = normalizeRelativeModulePath(fromPath, modulePath);
	if (!normalized) {
		return null;
	}
	const candidates = [
		normalized,
		`${normalized}.ts`,
		`${normalized}.tsx`,
		`${normalized}.js`,
		`${normalized}.jsx`,
		`${normalized}.mjs`,
		`${normalized}.cjs`,
		`${normalized}/index.ts`,
		`${normalized}/index.tsx`,
		`${normalized}/index.js`,
		`${normalized}/index.jsx`,
	];
	return candidates.find((candidate) => filePathSet.has(candidate)) ?? null;
}

function countReferencesBySymbol(files: readonly SourceFile[]): Map<string, number> {
	const counts = new Map<string, number>();
	const filePathSet = new Set(files.map((file) => file.path));
	const symbolsByPath = new Map(files.map((file) => [file.path, file.symbols] as const));
	const identifierCountsByPath = new Map<string, Map<string, number>>();
	for (const file of files) {
		const identifierCounts = new Map<string, number>();
		for (const identifier of file.identifiers) {
			identifierCounts.set(identifier, (identifierCounts.get(identifier) ?? 0) + 1);
		}
		identifierCountsByPath.set(file.path, identifierCounts);
		for (const symbol of file.symbols) {
			counts.set(symbolKey(symbol), identifierCounts.get(symbol.name) ?? 0);
		}
	}
	// Import contributions are a second pass: otherwise a lexically later definition file overwrites references already
	// added by an earlier importer, making counts depend on path order.
	for (const file of files) {
		const identifierCounts = identifierCountsByPath.get(file.path) ?? new Map<string, number>();
		for (const importEntry of file.imports) {
			const targetPath = resolveImportTargetPath(file.path, importEntry.modulePath, filePathSet);
			if (!targetPath) continue;
			const importedBindings = new Map(
				(
					importEntry.bindings ??
					importEntry.importedNames.map((name) => ({ importedName: name, localName: name }))
				).map((binding) => [binding.importedName, binding.localName]),
			);
			for (const target of symbolsByPath.get(targetPath) ?? []) {
				const localName = importedBindings.get(target.name);
				if (!localName) continue;
				const importedReferences = identifierCounts.get(localName) ?? 0;
				counts.set(symbolKey(target), (counts.get(symbolKey(target)) ?? 0) + importedReferences);
			}
		}
	}
	return counts;
}

function normalizeRepoMapPath(path: string): string {
	return path.trim().replace(/\\/g, "/").replace(/^\.\//, "");
}

function buildRepoMapPersonalization(
	options: Pick<BuildNKleinRepoMapOptions, "personalizationText" | "seedPaths">,
	filePaths: readonly string[],
): RepoMapPersonalization {
	const identifierCounts = new Map<string, number>();
	const text = options.personalizationText?.trim() ?? "";
	for (const match of text.matchAll(/\b[A-Za-z_$][\w$]*\b/g)) {
		const identifier = match[0];
		identifierCounts.set(identifier, (identifierCounts.get(identifier) ?? 0) + 1);
	}

	const seedPaths = new Set<string>();
	for (const seedPath of options.seedPaths ?? []) {
		const normalized = normalizeRepoMapPath(seedPath);
		if (normalized) {
			seedPaths.add(normalized);
		}
	}
	for (const filePath of filePaths) {
		const normalizedPath = normalizeRepoMapPath(filePath);
		if (text.includes(filePath) || text.includes(normalizedPath)) {
			seedPaths.add(filePath);
		}
	}

	return {
		identifierCounts,
		seedPaths,
	};
}

function buildPersonalizationWeights(
	symbols: readonly NKleinRepoMapSymbol[],
	personalization: RepoMapPersonalization,
): number[] {
	return symbols.map((symbol) => {
		const identifierBoost = personalization.identifierCounts.has(symbol.name) ? 10 : 1;
		const normalizedPath = normalizeRepoMapPath(symbol.path);
		const fileBoost =
			personalization.seedPaths.has(symbol.path) || personalization.seedPaths.has(normalizedPath) ? 50 : 1;
		return identifierBoost * fileBoost;
	});
}

function selectPageRankCandidates(
	symbols: readonly NKleinRepoMapSymbol[],
	personalization: RepoMapPersonalization,
): NKleinRepoMapSymbol[] {
	return [...symbols]
		.sort((left, right) => {
			const leftPersonalized =
				personalization.identifierCounts.has(left.name) ||
				personalization.seedPaths.has(normalizeRepoMapPath(left.path));
			const rightPersonalized =
				personalization.identifierCounts.has(right.name) ||
				personalization.seedPaths.has(normalizeRepoMapPath(right.path));
			if (leftPersonalized !== rightPersonalized) return leftPersonalized ? -1 : 1;
			const referenceDelta = Math.sqrt(right.referenceCount) - Math.sqrt(left.referenceCount);
			if (Math.abs(referenceDelta) > Number.EPSILON) return referenceDelta > 0 ? 1 : -1;
			return `${left.path}:${left.line}:${left.name}`.localeCompare(`${right.path}:${right.line}:${right.name}`);
		})
		.slice(0, MAX_PAGERANK_SYMBOLS);
}

function rankSymbols(files: readonly SourceFile[], personalization: RepoMapPersonalization): NKleinRepoMapSymbol[] {
	const referenceCounts = countReferencesBySymbol(files);
	const symbols = selectPageRankCandidates(
		files
			.flatMap((file) => file.symbols)
			.map((symbol) => ({
				...symbol,
				referenceCount: referenceCounts.get(symbolKey(symbol)) ?? 0,
			})),
		personalization,
	);
	const symbolIndexesByName = new Map<string, number[]>();
	const symbolIndexesByPath = new Map<string, number[]>();
	for (const [index, symbol] of symbols.entries()) {
		const byName = symbolIndexesByName.get(symbol.name) ?? [];
		byName.push(index);
		symbolIndexesByName.set(symbol.name, byName);
		const byPath = symbolIndexesByPath.get(symbol.path) ?? [];
		byPath.push(index);
		symbolIndexesByPath.set(symbol.path, byPath);
	}
	const filePathSet = new Set(files.map((file) => file.path));
	const edges = new Map<number, Map<number, number>>();
	for (const file of files) {
		const localSymbolIndexes = symbolIndexesByPath.get(file.path) ?? [];
		if (localSymbolIndexes.length === 0) {
			continue;
		}
		const identifierCounts = new Map<string, number>();
		for (const identifier of file.identifiers) {
			identifierCounts.set(identifier, (identifierCounts.get(identifier) ?? 0) + 1);
		}
		for (const [identifier, count] of identifierCounts) {
			// Unqualified identifier text is meaningful only inside the same file. Cross-file edges come from resolved
			// imports below; joining every same-spelled identifier repo-wide made generic names such as `result` and `push`
			// look like the architecture's most important entry points.
			const targetIndexes = (symbolIndexesByName.get(identifier) ?? []).filter(
				(index) => symbols[index]?.path === file.path,
			);
			for (const sourceIndex of localSymbolIndexes) {
				for (const targetIndex of targetIndexes) {
					addWeightedEdge(edges, sourceIndex, targetIndex, count);
				}
			}
		}
		for (const importEntry of file.imports) {
			const targetPath = resolveImportTargetPath(file.path, importEntry.modulePath, filePathSet);
			if (!targetPath) {
				continue;
			}
			const importedNameSet = new Set(
				(
					importEntry.bindings ??
					importEntry.importedNames.map((name) => ({ importedName: name, localName: name }))
				).map((binding) => binding.importedName),
			);
			const importedSymbolIndexes = (symbolIndexesByPath.get(targetPath) ?? []).filter((index) => {
				const symbol = symbols[index];
				return symbol ? importedNameSet.has(symbol.name) : false;
			});
			for (const sourceIndex of localSymbolIndexes) {
				for (const targetIndex of importedSymbolIndexes) {
					addWeightedEdge(edges, sourceIndex, targetIndex, 4);
				}
			}
		}
	}
	const personalizationWeights = buildPersonalizationWeights(symbols, personalization);
	const ranks = calculatePageRank(symbols.length, edges, buildPersonalizationVector(personalizationWeights));
	return symbols
		.map((symbol, index) => ({
			...symbol,
			// Aider-style reference weighting rewards well-connected definitions without letting raw reference volume
			// overwhelm personalized PageRank. Retain the declared 10x task / 50x in-context-file priority after graph
			// propagation as well, so a strongly connected generic symbol cannot displace the task's explicit seed.
			rankScore:
				(ranks[index] ?? 0) * Math.sqrt(Math.max(1, symbol.referenceCount)) * (personalizationWeights[index] ?? 1),
		}))
		.sort((left, right) => {
			const rankDelta = right.rankScore - left.rankScore;
			if (Math.abs(rankDelta) > Number.EPSILON) {
				return rankDelta > 0 ? 1 : -1;
			}
			const referenceDelta = right.referenceCount - left.referenceCount;
			if (referenceDelta !== 0) {
				return referenceDelta;
			}
			return `${left.path}:${left.line}:${left.name}`.localeCompare(`${right.path}:${right.line}:${right.name}`);
		});
}

function renderSymbols(
	symbols: readonly NKleinRepoMapSymbol[],
	tokenBudget: number,
): {
	rendered: string;
	tokenCount: number;
	truncated: boolean;
} {
	const lines = [
		"Repo map:",
		...symbols.map(
			(symbol) =>
				`${symbol.path}:${symbol.line} ${symbol.kind} ${symbol.name} refs=${symbol.referenceCount} rank=${symbol.rankScore.toFixed(4)}`,
		),
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

export async function buildNKleinRepoMap(options: BuildNKleinRepoMapOptions): Promise<NKleinRepoMap> {
	const tokenBudget =
		typeof options.tokenBudget === "number" && Number.isFinite(options.tokenBudget) && options.tokenBudget > 0
			? Math.trunc(options.tokenBudget)
			: DEFAULT_TOKEN_BUDGET;
	const maxFiles =
		typeof options.maxFiles === "number" && Number.isFinite(options.maxFiles) && options.maxFiles > 0
			? Math.trunc(options.maxFiles)
			: DEFAULT_MAX_FILES;
	const filePaths = await listSourceFiles(
		options.workspacePath,
		maxFiles,
		options.personalizationText,
		options.seedPaths,
	);
	const files: SourceFile[] = [];
	for (const filePath of filePaths) {
		const sourcePath = relative(options.workspacePath, filePath);
		const content = await readFile(filePath, "utf8");
		// F12.67: unchanged files (same content hash) reuse their cached extraction facts — only changed files
		// re-run the AST parse. The cache is caller-owned; no cache = the original full-parse path.
		const hash = options.factsCache ? fnv1aContentHash(content) : null;
		const cached = hash !== null ? options.factsCache?.get(sourcePath) : undefined;
		const facts = cached && cached.hash === hash ? cached.facts : extractSourceFacts(sourcePath, content);
		if (hash !== null && (!cached || cached.hash !== hash)) {
			options.factsCache?.set(sourcePath, { hash, facts });
		}
		files.push({
			path: sourcePath,
			...facts,
		});
	}
	const rankedSymbols = rankSymbols(
		files,
		buildRepoMapPersonalization(
			{
				personalizationText: options.personalizationText,
				seedPaths: options.seedPaths,
			},
			files.map((file) => file.path),
		),
	);
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

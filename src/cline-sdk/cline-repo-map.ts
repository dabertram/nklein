import { readdir, readFile, stat } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import ts from "typescript";
import { countKanbanTextTokens } from "./cline-context-budgets";

const DEFAULT_MAX_FILES = 1_000;
const DEFAULT_TOKEN_BUDGET = 1_200;
const MAX_REFERENCE_RANK_SYMBOLS = 500;
const PAGERANK_DAMPING = 0.85;
const PAGERANK_ITERATIONS = 24;
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
	rankScore: number;
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
	identifiers: string[];
	imports: SourceImport[];
	symbols: ClineRepoMapSymbol[];
}

interface SourceImport {
	modulePath: string;
	importedNames: string[];
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

function createSymbol(path: string, content: string, name: string, kind: string, position: number): ClineRepoMapSymbol {
	return {
		name,
		kind,
		path,
		line: content.slice(0, position).split("\n").length,
		referenceCount: 0,
		rankScore: 0,
	};
}

function getDeclarationName(node: ts.Node): ts.Identifier | null {
	if (
		(ts.isFunctionDeclaration(node) ||
			ts.isClassDeclaration(node) ||
			ts.isInterfaceDeclaration(node) ||
			ts.isTypeAliasDeclaration(node) ||
			ts.isEnumDeclaration(node)) &&
		node.name
	) {
		return node.name;
	}
	return null;
}

function getDeclarationKind(node: ts.Node, name: string): string {
	if (ts.isFunctionDeclaration(node)) {
		return name.startsWith("use") && /^use[A-Z]/.test(name) ? "hook" : "function";
	}
	if (ts.isClassDeclaration(node)) {
		return "class";
	}
	if (ts.isInterfaceDeclaration(node)) {
		return "interface";
	}
	if (ts.isTypeAliasDeclaration(node)) {
		return "type";
	}
	if (ts.isEnumDeclaration(node)) {
		return "enum";
	}
	return "symbol";
}

function readImportNames(clause: ts.ImportClause | undefined): string[] {
	if (!clause) {
		return [];
	}
	const names: string[] = [];
	if (clause.name) {
		names.push(clause.name.text);
	}
	if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
		for (const element of clause.namedBindings.elements) {
			names.push((element.propertyName ?? element.name).text);
		}
	}
	return names;
}

function extractAstSourceFacts(path: string, content: string): Pick<SourceFile, "identifiers" | "imports" | "symbols"> {
	const sourceKind =
		getExtension(path) === ".tsx" || getExtension(path) === ".jsx" ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
	const sourceFile = ts.createSourceFile(path, content, ts.ScriptTarget.Latest, true, sourceKind);
	const identifiers: string[] = [];
	const imports: SourceImport[] = [];
	const symbols: ClineRepoMapSymbol[] = [];
	const visit = (node: ts.Node): void => {
		if (ts.isIdentifier(node)) {
			identifiers.push(node.text);
		}
		if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
			imports.push({
				modulePath: node.moduleSpecifier.text,
				importedNames: readImportNames(node.importClause),
			});
		}
		const declarationName = getDeclarationName(node);
		if (declarationName) {
			symbols.push(
				createSymbol(
					path,
					content,
					declarationName.text,
					getDeclarationKind(node, declarationName.text),
					declarationName.getStart(sourceFile),
				),
			);
		}
		if (ts.isVariableStatement(node)) {
			for (const declaration of node.declarationList.declarations) {
				if (ts.isIdentifier(declaration.name)) {
					const name = declaration.name.text;
					symbols.push(
						createSymbol(
							path,
							content,
							name,
							name.startsWith("use") && /^use[A-Z]/.test(name) ? "hook" : "const",
							declaration.name.getStart(sourceFile),
						),
					);
				}
			}
		}
		ts.forEachChild(node, visit);
	};
	visit(sourceFile);
	return { identifiers, imports, symbols };
}

function extractRegexSymbolsFromContent(path: string, content: string): ClineRepoMapSymbol[] {
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

function countReferences(symbolName: string, files: readonly SourceFile[]): number {
	const escaped = symbolName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const pattern = new RegExp(`\\b${escaped}\\b`, "g");
	return files.reduce((total, file) => total + Array.from(file.content.matchAll(pattern)).length, 0);
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

function addWeightedEdge(
	edges: Map<number, Map<number, number>>,
	fromIndex: number,
	toIndex: number,
	weight: number,
): void {
	if (fromIndex === toIndex || weight <= 0) {
		return;
	}
	const outgoing = edges.get(fromIndex) ?? new Map<number, number>();
	outgoing.set(toIndex, (outgoing.get(toIndex) ?? 0) + weight);
	edges.set(fromIndex, outgoing);
}

function calculatePageRank(symbolCount: number, edges: ReadonlyMap<number, ReadonlyMap<number, number>>): number[] {
	if (symbolCount === 0) {
		return [];
	}
	let ranks = Array.from({ length: symbolCount }, () => 1 / symbolCount);
	for (let iteration = 0; iteration < PAGERANK_ITERATIONS; iteration += 1) {
		const nextRanks = Array.from({ length: symbolCount }, () => (1 - PAGERANK_DAMPING) / symbolCount);
		let danglingRank = 0;
		for (let fromIndex = 0; fromIndex < symbolCount; fromIndex += 1) {
			const outgoing = edges.get(fromIndex);
			if (!outgoing || outgoing.size === 0) {
				danglingRank += ranks[fromIndex] ?? 0;
				continue;
			}
			const totalWeight = [...outgoing.values()].reduce((total, weight) => total + weight, 0);
			for (const [toIndex, weight] of outgoing) {
				nextRanks[toIndex] =
					(nextRanks[toIndex] ?? 0) + PAGERANK_DAMPING * (ranks[fromIndex] ?? 0) * (weight / totalWeight);
			}
		}
		const danglingShare = (PAGERANK_DAMPING * danglingRank) / symbolCount;
		ranks = nextRanks.map((rank) => rank + danglingShare);
	}
	return ranks;
}

function rankSymbols(files: readonly SourceFile[]): ClineRepoMapSymbol[] {
	const symbols = files
		.flatMap((file) => file.symbols)
		.sort((left, right) =>
			`${left.path}:${left.line}:${left.name}`.localeCompare(`${right.path}:${right.line}:${right.name}`),
		)
		.slice(0, MAX_REFERENCE_RANK_SYMBOLS)
		.map((symbol) => ({
			...symbol,
			referenceCount: countReferences(symbol.name, files),
		}));
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
			const targetIndexes = symbolIndexesByName.get(identifier) ?? [];
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
			const importedNameSet = new Set(importEntry.importedNames);
			const importedSymbolIndexes = (symbolIndexesByPath.get(targetPath) ?? []).filter((index) => {
				const symbol = symbols[index];
				return symbol ? importedNameSet.size === 0 || importedNameSet.has(symbol.name) : false;
			});
			for (const sourceIndex of localSymbolIndexes) {
				for (const targetIndex of importedSymbolIndexes) {
					addWeightedEdge(edges, sourceIndex, targetIndex, 4);
				}
			}
		}
	}
	const ranks = calculatePageRank(symbols.length, edges);
	return symbols
		.map((symbol, index) => ({
			...symbol,
			rankScore: ranks[index] ?? 0,
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
	symbols: readonly ClineRepoMapSymbol[],
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
		const sourcePath = relative(options.workspacePath, filePath);
		const content = await readFile(filePath, "utf8");
		const facts = extractSourceFacts(sourcePath, content);
		files.push({
			path: sourcePath,
			content,
			...facts,
		});
	}
	const rankedSymbols = rankSymbols(files);
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

import { readFile } from "node:fs/promises";
import { relative } from "node:path";
import ts from "typescript";
import { listSourceFiles } from "./source-file-scan";

/**
 * F12.1(a) structural (shape) search on the VENDORED TypeScript AST — the middle tier of the 2026 code-search
 * consensus (lexical ripgrep → structural AST → semantic repo-map). Finds code *by shape* where a text grep drowns
 * in noise: all CALLERS of a function, all DEFINITIONS of a symbol, all classes IMPLEMENTING/extending a type.
 * Deliberately dependency-free (path (a) of the F12.1 decision): the `typescript` module already ships for the
 * repo-map's AST facts, and TS/JS is this fleet's dominant surface; non-TS files simply don't match (the lexical
 * tier still covers them). `findAstShapeMatches` is pure over file contents; the I/O wrapper scans the workspace.
 */

export type AstShapeQueryKind = "callers" | "definitions" | "implementations" | "references";

export interface AstShapeQuery {
	readonly kind: AstShapeQueryKind;
	/** The symbol name to match, exact identifier (case-sensitive). */
	readonly symbol: string;
}

export interface AstShapeMatch {
	readonly path: string;
	readonly line: number;
	/** The matched source line, trimmed. */
	readonly snippet: string;
	/** The enclosing named declaration (the "who" for a caller match), when one exists. */
	readonly enclosing: string | null;
}

const TS_EXTENSIONS = /\.(ts|tsx|js|jsx|mjs|cjs)$/i;

function lineOf(content: string, position: number): number {
	return content.slice(0, position).split("\n").length;
}

function lineText(content: string, line: number): string {
	return (content.split("\n")[line - 1] ?? "").trim().slice(0, 200);
}

function enclosingDeclarationName(node: ts.Node): string | null {
	let current: ts.Node | undefined = node.parent;
	while (current) {
		if (
			(ts.isFunctionDeclaration(current) || ts.isMethodDeclaration(current) || ts.isClassDeclaration(current)) &&
			current.name
		) {
			return current.name.getText();
		}
		if (ts.isVariableDeclaration(current) && ts.isIdentifier(current.name)) {
			return current.name.text;
		}
		current = current.parent;
	}
	return null;
}

/** Pure shape matcher over one file's content. Non-TS-family files return no matches. */
export function findAstShapeMatches(path: string, content: string, query: AstShapeQuery): AstShapeMatch[] {
	if (!TS_EXTENSIONS.test(path)) {
		return [];
	}
	const source = ts.createSourceFile(path, content, ts.ScriptTarget.Latest, true);
	const matches: AstShapeMatch[] = [];
	const push = (node: ts.Node) => {
		const line = lineOf(content, node.getStart(source));
		matches.push({ path, line, snippet: lineText(content, line), enclosing: enclosingDeclarationName(node) });
	};
	const visit = (node: ts.Node) => {
		if (query.kind === "callers" && ts.isCallExpression(node)) {
			const callee = node.expression;
			const name = ts.isIdentifier(callee)
				? callee.text
				: ts.isPropertyAccessExpression(callee)
					? callee.name.text
					: null;
			if (name === query.symbol) {
				push(node);
			}
		} else if (query.kind === "definitions") {
			const declarationName =
				(ts.isFunctionDeclaration(node) ||
					ts.isClassDeclaration(node) ||
					ts.isInterfaceDeclaration(node) ||
					ts.isTypeAliasDeclaration(node) ||
					ts.isEnumDeclaration(node) ||
					ts.isMethodDeclaration(node)) &&
				node.name &&
				ts.isIdentifier(node.name)
					? node.name.text
					: ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)
						? node.name.text
						: null;
			if (declarationName === query.symbol) {
				push(node);
			}
		} else if (query.kind === "references" && ts.isIdentifier(node) && node.text === query.symbol) {
			// Serena-style find_referencing_symbols (TS slice): every identifier USAGE — excluding the declaration's
			// own name token, so "who touches X" doesn't echo X's definition back.
			const parent = node.parent;
			const isDeclarationName =
				parent &&
				(ts.isFunctionDeclaration(parent) ||
					ts.isClassDeclaration(parent) ||
					ts.isInterfaceDeclaration(parent) ||
					ts.isTypeAliasDeclaration(parent) ||
					ts.isEnumDeclaration(parent) ||
					ts.isMethodDeclaration(parent) ||
					ts.isVariableDeclaration(parent)) &&
				parent.name === node;
			if (!isDeclarationName) {
				push(node);
			}
		} else if (query.kind === "implementations" && ts.isClassDeclaration(node)) {
			for (const heritage of node.heritageClauses ?? []) {
				for (const type of heritage.types) {
					const expr = type.expression;
					if (ts.isIdentifier(expr) && expr.text === query.symbol) {
						push(node);
					}
				}
			}
		}
		ts.forEachChild(node, visit);
	};
	visit(source);
	return matches;
}

export interface AstSearchResult {
	readonly query: AstShapeQuery;
	readonly matches: AstShapeMatch[];
	readonly filesScanned: number;
	readonly truncated: boolean;
}

/** Scan the workspace and run the shape query. Results capped at `maxResults` (default 30). */
export async function searchAstShapes(options: {
	workspacePath: string;
	query: AstShapeQuery;
	maxFiles?: number;
	maxResults?: number;
}): Promise<AstSearchResult> {
	const maxResults = options.maxResults ?? 30;
	const filePaths = await listSourceFiles(options.workspacePath, options.maxFiles ?? 400);
	const matches: AstShapeMatch[] = [];
	let filesScanned = 0;
	for (const filePath of filePaths) {
		const path = relative(options.workspacePath, filePath);
		if (!TS_EXTENSIONS.test(path)) {
			continue;
		}
		filesScanned += 1;
		try {
			matches.push(...findAstShapeMatches(path, await readFile(filePath, "utf8"), options.query));
		} catch {
			// A single unreadable/unparseable file never sinks the search.
		}
		if (matches.length > maxResults) {
			break;
		}
	}
	return {
		query: options.query,
		matches: matches.slice(0, maxResults),
		filesScanned,
		truncated: matches.length > maxResults,
	};
}

import { readFile } from "node:fs/promises";
import { relative } from "node:path";
import { pattern as compileAstPattern, Lang, parse, type SgNode } from "@ast-grep/napi";
import { listSourceFiles } from "./source-file-scan";

/** F11.2b structural code search. ast-grep runs tree-sitter patterns without matching comments or string contents. */
export type AstShapeQueryKind = "callers" | "definitions" | "implementations" | "references";
export type AstPatternLanguage = "auto" | "javascript" | "tsx" | "typescript";

export interface AstShapeQuery {
	readonly kind: AstShapeQueryKind;
	/** The symbol name to match, exact identifier (case-sensitive). */
	readonly symbol: string;
}

export interface AstPatternQuery {
	readonly kind: "pattern";
	/** ast-grep source pattern, including metavariables such as `$FUNC` and `$$$ARGS`. */
	readonly pattern: string;
	readonly language?: AstPatternLanguage;
}

export type AstSearchQuery = AstShapeQuery | AstPatternQuery;

export interface AstShapeMatch {
	readonly path: string;
	readonly line: number;
	/** The matched source line, trimmed. */
	readonly snippet: string;
	/** The enclosing named declaration (the "who" for a match), when one exists. */
	readonly enclosing: string | null;
}

const JS_EXTENSIONS = /\.(?:cjs|js|mjs)$/iu;
const JSX_EXTENSIONS = /\.(?:jsx|tsx)$/iu;
const TS_EXTENSIONS = /\.(?:cts|mts|ts)$/iu;

function astLanguageForPath(path: string): Lang | null {
	if (JSX_EXTENSIONS.test(path)) return Lang.Tsx;
	if (JS_EXTENSIONS.test(path)) return Lang.JavaScript;
	if (TS_EXTENSIONS.test(path)) return Lang.TypeScript;
	return null;
}

function queryAllowsLanguage(query: AstPatternQuery, language: Lang): boolean {
	switch (query.language ?? "auto") {
		case "javascript":
			return language === Lang.JavaScript;
		case "tsx":
			return language === Lang.Tsx;
		case "typescript":
			return language === Lang.TypeScript;
		default:
			return true;
	}
}

function fieldNode(node: SgNode, fieldName: string): SgNode | null {
	return (node.field as (name: string) => SgNode | null)(fieldName);
}

function nodesByKind(root: SgNode, kinds: readonly string[]): SgNode[] {
	const nodes: SgNode[] = [];
	for (const kind of kinds) {
		try {
			nodes.push(...root.findAll({ rule: { kind } }));
		} catch {
			// Tree-sitter grammars reject foreign node kinds (for example `interface_declaration` in JavaScript).
		}
	}
	return nodes;
}

function lineText(content: string, line: number): string {
	return (content.split("\n")[line - 1] ?? "").trim().slice(0, 200);
}

const ENCLOSING_DECLARATIONS = new Set([
	"class_declaration",
	"function_declaration",
	"generator_function_declaration",
	"method_definition",
	"variable_declarator",
]);

function enclosingDeclarationName(node: SgNode): string | null {
	for (const ancestor of node.ancestors()) {
		if (!ENCLOSING_DECLARATIONS.has(String(ancestor.kind()))) continue;
		const name = fieldNode(ancestor, "name")?.text().trim();
		if (name) return name;
	}
	return null;
}

function toMatch(path: string, content: string, node: SgNode): AstShapeMatch {
	const line = node.range().start.line + 1;
	return { path, line, snippet: lineText(content, line), enclosing: enclosingDeclarationName(node) };
}

function calleeName(call: SgNode): string | null {
	const callee = fieldNode(call, "function");
	if (!callee) return null;
	if (callee.kind() === "identifier") return callee.text();
	if (callee.kind() === "member_expression" || callee.kind() === "subscript_expression") {
		return fieldNode(callee, "property")?.text() ?? null;
	}
	return null;
}

const DEFINITION_KINDS = [
	"class_declaration",
	"enum_declaration",
	"function_declaration",
	"generator_function_declaration",
	"interface_declaration",
	"method_definition",
	"type_alias_declaration",
	"variable_declarator",
] as const;

function isDeclarationName(node: SgNode): boolean {
	const parent = node.parent();
	return parent
		? DEFINITION_KINDS.includes(String(parent.kind()) as (typeof DEFINITION_KINDS)[number]) &&
				fieldNode(parent, "name")?.id() === node.id()
		: false;
}

function findShapeNodes(root: SgNode, query: AstShapeQuery): SgNode[] {
	switch (query.kind) {
		case "callers":
			return nodesByKind(root, ["call_expression"]).filter((node) => calleeName(node) === query.symbol);
		case "definitions":
			return nodesByKind(root, DEFINITION_KINDS).filter((node) => fieldNode(node, "name")?.text() === query.symbol);
		case "references":
			return nodesByKind(root, ["identifier", "property_identifier", "type_identifier"]).filter(
				(node) => node.text() === query.symbol && !isDeclarationName(node),
			);
		case "implementations":
			return nodesByKind(root, ["class_declaration"]).filter((node) => {
				const heritage = node.children().find((child) => child.kind() === "class_heritage");
				return heritage
					? nodesByKind(heritage, ["identifier", "type_identifier"]).some((name) => name.text() === query.symbol)
					: false;
			});
	}
}

/** Pure structural matcher over one JS/TS-family file. Other languages return no matches. */
export function findAstShapeMatches(path: string, content: string, query: AstShapeQuery): AstShapeMatch[] {
	const language = astLanguageForPath(path);
	if (!language) return [];
	const root = parse(language, content).root();
	return findShapeNodes(root, query).map((node) => toMatch(path, content, node));
}

/** Pure arbitrary ast-grep pattern matcher over one JS/TS-family file. */
export function findAstPatternMatches(path: string, content: string, query: AstPatternQuery): AstShapeMatch[] {
	const language = astLanguageForPath(path);
	if (!language || !queryAllowsLanguage(query, language)) return [];
	const root = parse(language, content).root();
	const matcher = compileAstPattern(language, query.pattern);
	return root.findAll(matcher).map((node) => toMatch(path, content, node));
}

export interface AstSearchResult {
	readonly query: AstSearchQuery;
	readonly matches: AstShapeMatch[];
	readonly filesScanned: number;
	readonly truncated: boolean;
}

/** Scan the workspace and run one structural query. Results are capped at `maxResults` (default 30). */
export async function searchAstShapes(options: {
	workspacePath: string;
	query: AstSearchQuery;
	maxFiles?: number;
	maxResults?: number;
}): Promise<AstSearchResult> {
	const maxResults = options.maxResults ?? 30;
	const filePaths = await listSourceFiles(options.workspacePath, options.maxFiles ?? 400);
	const matches: AstShapeMatch[] = [];
	let filesScanned = 0;
	for (const filePath of filePaths) {
		const path = relative(options.workspacePath, filePath);
		const language = astLanguageForPath(path);
		if (!language || (options.query.kind === "pattern" && !queryAllowsLanguage(options.query, language))) continue;
		filesScanned += 1;
		const content = await readFile(filePath, "utf8");
		const fileMatches =
			options.query.kind === "pattern"
				? findAstPatternMatches(path, content, options.query)
				: findAstShapeMatches(path, content, options.query);
		matches.push(...fileMatches);
		if (matches.length > maxResults) break;
	}
	return {
		query: options.query,
		matches: matches.slice(0, maxResults),
		filesScanned,
		truncated: matches.length > maxResults,
	};
}

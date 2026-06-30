import ts from "typescript";
import type { NKleinRepoMapSymbol } from "./nklein-repo-map";

/**
 * TypeScript-AST source-fact extraction for the repo map, extracted from nklein-repo-map. Pure: it
 * parses a file's content with the TS compiler API and collects identifiers, imports, and declared
 * symbols. `NKleinRepoMapSymbol` is a type-only import (erased at build, so no runtime cycle) and a
 * local `getExtension` keeps the module self-contained (the owner keeps its own copy for file scanning).
 */

/** The subset of source facts the repo map derives from a file's AST. */
export interface RepoMapAstFacts {
	identifiers: string[];
	imports: Array<{ modulePath: string; importedNames: string[] }>;
	symbols: NKleinRepoMapSymbol[];
}

function getExtension(path: string): string {
	const index = path.lastIndexOf(".");
	return index >= 0 ? path.slice(index).toLowerCase() : "";
}

/** Build a repo-map symbol, deriving its 1-based line from the byte offset in the file content. */
export function createSymbol(
	path: string,
	content: string,
	name: string,
	kind: string,
	position: number,
): NKleinRepoMapSymbol {
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

/** Parse a TS/JS file's content and collect its identifiers, imports, and declared symbols. */
export function extractAstSourceFacts(path: string, content: string): RepoMapAstFacts {
	const sourceKind =
		getExtension(path) === ".tsx" || getExtension(path) === ".jsx" ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
	const sourceFile = ts.createSourceFile(path, content, ts.ScriptTarget.Latest, true, sourceKind);
	const identifiers: string[] = [];
	const imports: Array<{ modulePath: string; importedNames: string[] }> = [];
	const symbols: NKleinRepoMapSymbol[] = [];
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

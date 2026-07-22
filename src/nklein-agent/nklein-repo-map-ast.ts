import { Lang, parse, type SgNode } from "@ast-grep/napi";
import type { NKleinRepoMapSymbol } from "./nklein-repo-map";

/** The subset of source facts the repo map derives from a tree-sitter syntax tree. */
export interface RepoMapAstFacts {
	identifiers: string[];
	imports: RepoMapAstImport[];
	symbols: NKleinRepoMapSymbol[];
}

export interface RepoMapAstImportBinding {
	/** Name exported by the target module. */
	importedName: string;
	/** Name referenced inside the importing file. */
	localName: string;
}

export interface RepoMapAstImport {
	modulePath: string;
	importedNames: string[];
	bindings: RepoMapAstImportBinding[];
}

function getExtension(path: string): string {
	const index = path.lastIndexOf(".");
	return index >= 0 ? path.slice(index).toLowerCase() : "";
}

function languageForPath(path: string): Lang {
	switch (getExtension(path)) {
		case ".tsx":
		case ".jsx":
			return Lang.Tsx;
		case ".js":
		case ".mjs":
		case ".cjs":
			return Lang.JavaScript;
		default:
			return Lang.TypeScript;
	}
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

function fieldText(node: SgNode, fieldName: string): string | null {
	// The untyped API deliberately permits language-dependent field names at runtime. Its generic default cannot express
	// those names statically, so isolate that boundary here instead of spreading casts through extraction logic.
	const field = (node.field as (name: string) => SgNode | null)(fieldName);
	return field?.text() ?? null;
}

function unquoteModulePath(text: string): string {
	const quote = text[0];
	return (quote === '"' || quote === "'" || quote === "`") && text.at(-1) === quote ? text.slice(1, -1) : text;
}

function topLevelDeclaration(node: SgNode): SgNode | null {
	if (node.kind() !== "export_statement") return node;
	return node.children().find((child) => child.isNamed() && child.kind() !== "decorator") ?? null;
}

function declarationKind(nodeKind: string, name: string): string | null {
	switch (nodeKind) {
		case "function_declaration":
		case "generator_function_declaration":
			return name.startsWith("use") && /^use[A-Z]/u.test(name) ? "hook" : "function";
		case "class_declaration":
			return "class";
		case "interface_declaration":
			return "interface";
		case "type_alias_declaration":
			return "type";
		case "enum_declaration":
			return "enum";
		default:
			return null;
	}
}

function collectTopLevelSymbols(path: string, content: string, root: SgNode): NKleinRepoMapSymbol[] {
	const symbols: NKleinRepoMapSymbol[] = [];
	for (const child of root.children()) {
		const declaration = topLevelDeclaration(child);
		if (!declaration) continue;
		if (declaration.kind() === "lexical_declaration" || declaration.kind() === "variable_declaration") {
			for (const variable of declaration
				.children()
				.filter((candidate) => candidate.kind() === "variable_declarator")) {
				const nameNode = (variable.field as (name: string) => SgNode | null)("name");
				const name = nameNode?.text() ?? "";
				if (!name || !nameNode) continue;
				symbols.push(
					createSymbol(
						path,
						content,
						name,
						name.startsWith("use") && /^use[A-Z]/u.test(name) ? "hook" : "const",
						nameNode.range().start.index,
					),
				);
			}
			continue;
		}
		const nameNode = (declaration.field as (name: string) => SgNode | null)("name");
		const name = nameNode?.text() ?? "";
		const kind = declarationKind(String(declaration.kind()), name);
		if (!nameNode || !name || !kind) continue;
		symbols.push(createSymbol(path, content, name, kind, nameNode.range().start.index));
	}
	return symbols;
}

function collectIdentifiers(root: SgNode, language: Lang): string[] {
	// Run the walk inside ast-grep/Rust. Crossing the N-API boundary once per syntax node roughly doubles a 1,000-file
	// first map on a real repo; returning only identifier leaves preserves the same graph evidence without that tax.
	const identifiers = root.findAll({ rule: { kind: "identifier" } }).map((node) => node.text());
	if (language === Lang.TypeScript || language === Lang.Tsx) {
		identifiers.push(...root.findAll({ rule: { kind: "type_identifier" } }).map((node) => node.text()));
	}
	return identifiers;
}

function collectImports(root: SgNode): RepoMapAstImport[] {
	const imports: RepoMapAstImport[] = [];
	for (const node of root.children()) {
		if (node.kind() !== "import_statement") continue;
		const source = fieldText(node, "source");
		if (!source) continue;
		const bindings: RepoMapAstImportBinding[] = [];
		for (const specifier of node.findAll({ rule: { kind: "import_specifier" } })) {
			const importedName = fieldText(specifier, "name") ?? "";
			const localName = fieldText(specifier, "alias") ?? importedName;
			if (importedName && localName) bindings.push({ importedName, localName });
		}
		imports.push({
			modulePath: unquoteModulePath(source),
			importedNames: bindings.map((binding) => binding.importedName),
			bindings,
		});
	}
	return imports;
}

/** Parse JS/TS with ast-grep's tree-sitter backend and collect identifiers, imports, and top-level declarations. */
export function extractAstSourceFacts(path: string, content: string): RepoMapAstFacts {
	const language = languageForPath(path);
	const root = parse(language, content).root();
	return {
		identifiers: collectIdentifiers(root, language),
		imports: collectImports(root),
		symbols: collectTopLevelSymbols(path, content, root),
	};
}

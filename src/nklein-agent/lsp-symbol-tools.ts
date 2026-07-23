import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { access, readdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
	createMessageConnection,
	type MessageConnection,
	StreamMessageReader,
	StreamMessageWriter,
} from "vscode-jsonrpc/node";

export interface LspPosition {
	line: number;
	character: number;
}

export interface LspRange {
	start: LspPosition;
	end: LspPosition;
}

interface LspLocation {
	uri: string;
	range: LspRange;
}

interface LspDocumentSymbol {
	name: string;
	kind: number;
	detail?: string;
	range: LspRange;
	selectionRange: LspRange;
	children?: LspDocumentSymbol[];
}

interface LspSymbolInformation {
	name: string;
	kind: number;
	containerName?: string;
	location: LspLocation;
}

interface LspTextEdit {
	range: LspRange;
	newText: string;
}

interface LspTextDocumentEdit {
	textDocument: { uri: string; version?: number | null };
	edits: LspTextEdit[];
}

interface LspWorkspaceEdit {
	changes?: Record<string, LspTextEdit[]>;
	documentChanges?: Array<LspTextDocumentEdit | { kind: string }>;
}

export interface SymbolToolResult {
	name: string;
	namePath: string;
	kind: string;
	relativePath: string;
	range: LspRange;
	detail?: string;
	body?: string;
}

interface IndexedDocumentSymbol {
	symbol: LspDocumentSymbol;
	namePath: string;
}

export interface LspProtocolClient {
	documentSymbols(uri: string): Promise<LspDocumentSymbol[] | LspSymbolInformation[] | null>;
	workspaceSymbols(query: string): Promise<LspSymbolInformation[] | null>;
	references(uri: string, position: LspPosition): Promise<LspLocation[] | null>;
	rename(uri: string, position: LspPosition, newName: string): Promise<LspWorkspaceEdit | null>;
	didOpen(uri: string, languageId: string, text: string): Promise<void>;
	didChange(uri: string, version: number, text: string): Promise<void>;
	dispose(): Promise<void>;
}

export const LSP_SYMBOL_KIND_NAMES: Record<number, string> = {
	1: "File",
	2: "Module",
	3: "Namespace",
	4: "Package",
	5: "Class",
	6: "Method",
	7: "Property",
	8: "Field",
	9: "Constructor",
	10: "Enum",
	11: "Interface",
	12: "Function",
	13: "Variable",
	14: "Constant",
	15: "String",
	16: "Number",
	17: "Boolean",
	18: "Array",
	19: "Object",
	20: "Key",
	21: "Null",
	22: "EnumMember",
	23: "Struct",
	24: "Event",
	25: "Operator",
	26: "TypeParameter",
};

function kindName(kind: number): string {
	return LSP_SYMBOL_KIND_NAMES[kind] ?? `Kind${kind}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isDocumentSymbol(value: unknown): value is LspDocumentSymbol {
	return isRecord(value) && isRecord(value.range) && isRecord(value.selectionRange);
}

function isSymbolInformation(value: unknown): value is LspSymbolInformation {
	return isRecord(value) && isRecord(value.location) && typeof value.location.uri === "string";
}

export function indexDocumentSymbols(
	symbols: readonly LspDocumentSymbol[],
	parentPath = "",
	depth = Number.POSITIVE_INFINITY,
): IndexedDocumentSymbol[] {
	const indexed: IndexedDocumentSymbol[] = [];
	for (const symbol of symbols) {
		const namePath = parentPath ? `${parentPath}/${symbol.name}` : symbol.name;
		indexed.push({ symbol, namePath });
		if (depth > 0 && symbol.children) {
			indexed.push(...indexDocumentSymbols(symbol.children, namePath, depth - 1));
		}
	}
	return indexed;
}

function leafName(namePath: string): string {
	const withoutAbsoluteMarker = namePath.startsWith("/") ? namePath.slice(1) : namePath;
	return withoutAbsoluteMarker.split("/").at(-1)?.trim() ?? "";
}

export function namePathMatches(candidate: string, pattern: string): boolean {
	const normalizedPattern = pattern.trim();
	if (!normalizedPattern) return false;
	if (normalizedPattern.startsWith("/")) return candidate === normalizedPattern.slice(1);
	return candidate === normalizedPattern || candidate.endsWith(`/${normalizedPattern}`);
}

export function positionToOffset(text: string, position: LspPosition): number {
	if (
		!Number.isInteger(position.line) ||
		!Number.isInteger(position.character) ||
		position.line < 0 ||
		position.character < 0
	) {
		throw new Error("LSP position must contain non-negative integer line and character values.");
	}
	let line = 0;
	let offset = 0;
	while (line < position.line) {
		const newline = text.indexOf("\n", offset);
		if (newline < 0) throw new Error(`LSP line ${position.line} is outside the file.`);
		offset = newline + 1;
		line += 1;
	}
	const lineEnd = text.indexOf("\n", offset);
	const maxOffset = lineEnd < 0 ? text.length : lineEnd;
	const target = offset + position.character;
	if (target > maxOffset) throw new Error(`LSP character ${position.character} is outside line ${position.line}.`);
	return target;
}

export function applyTextEdits(text: string, edits: readonly LspTextEdit[]): string {
	const normalized = edits
		.map((edit) => ({
			start: positionToOffset(text, edit.range.start),
			end: positionToOffset(text, edit.range.end),
			newText: edit.newText,
		}))
		.sort((left, right) => right.start - left.start || right.end - left.end);
	let previousStart = text.length;
	let output = text;
	for (const edit of normalized) {
		if (edit.end < edit.start) throw new Error("Language server returned an inverted text edit range.");
		if (edit.end > previousStart) throw new Error("Language server returned overlapping text edits.");
		output = `${output.slice(0, edit.start)}${edit.newText}${output.slice(edit.end)}`;
		previousStart = edit.start;
	}
	return output;
}

function languageIdForPath(path: string): string | null {
	if (/\.tsx$/i.test(path)) return "typescriptreact";
	if (/\.ts$/i.test(path)) return "typescript";
	if (/\.jsx$/i.test(path)) return "javascriptreact";
	if (/\.[cm]?js$/i.test(path)) return "javascript";
	return null;
}

function assertInsideRoot(root: string, candidate: string): void {
	const rel = relative(root, candidate);
	if (rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))) return;
	throw new Error("Language-server result escaped the sandbox workspace root.");
}

async function resolveExistingWorkspacePath(root: string, relativePath: string): Promise<string> {
	if (!relativePath.trim() || isAbsolute(relativePath)) {
		throw new Error("Provide a non-empty workspace-relative path.");
	}
	const lexical = resolve(root, relativePath);
	assertInsideRoot(root, lexical);
	const canonical = await realpath(lexical);
	assertInsideRoot(root, canonical);
	return canonical;
}

function compactDocumentSymbol(symbol: LspDocumentSymbol, namePath: string, relativePath: string): SymbolToolResult {
	return {
		name: symbol.name,
		namePath,
		kind: kindName(symbol.kind),
		relativePath,
		range: symbol.range,
		...(symbol.detail ? { detail: symbol.detail } : {}),
	};
}

function compactWorkspaceSymbol(symbol: LspSymbolInformation, root: string): SymbolToolResult {
	const absolutePath = fileURLToPath(symbol.location.uri);
	assertInsideRoot(root, absolutePath);
	const namePath = symbol.containerName ? `${symbol.containerName}/${symbol.name}` : symbol.name;
	return {
		name: symbol.name,
		namePath,
		kind: kindName(symbol.kind),
		relativePath: relative(root, absolutePath),
		range: symbol.location.range,
	};
}

export class TypeScriptLspClient implements LspProtocolClient {
	private constructor(
		private readonly child: ChildProcessWithoutNullStreams,
		private readonly connection: MessageConnection,
	) {}

	static async start(root: string): Promise<TypeScriptLspClient> {
		const child = spawn("typescript-language-server", ["--stdio", "--log-level", "1"], {
			cwd: root,
			stdio: ["pipe", "pipe", "pipe"],
			env: { ...process.env, NO_COLOR: "1" },
		});
		let stderr = "";
		child.stderr.setEncoding("utf8");
		child.stderr.on("data", (chunk: string) => {
			stderr = `${stderr}${chunk}`.slice(-8_000);
		});
		const connection = createMessageConnection(
			new StreamMessageReader(child.stdout),
			new StreamMessageWriter(child.stdin),
		);
		connection.onRequest("workspace/configuration", (params: unknown) => {
			const items = isRecord(params) && Array.isArray(params.items) ? params.items : [];
			return items.map(() => ({}));
		});
		connection.onRequest("client/registerCapability", () => null);
		connection.onRequest("window/workDoneProgress/create", () => null);
		connection.onRequest("workspace/workspaceFolders", () => [
			{ uri: pathToFileURL(root).href, name: basename(root) },
		]);
		connection.listen();
		const exited = new Promise<never>((_resolve, reject) => {
			child.once("error", reject);
			child.once("exit", (code, signal) => {
				reject(
					new Error(
						`TypeScript language server exited during initialization (${signal ?? code ?? "unknown"}). ${stderr}`,
					),
				);
			});
		});
		const initialized = connection.sendRequest("initialize", {
			processId: process.pid,
			rootUri: pathToFileURL(root).href,
			workspaceFolders: [{ uri: pathToFileURL(root).href, name: basename(root) }],
			capabilities: {
				workspace: { configuration: true, workspaceFolders: true, symbol: { resolveSupport: { properties: [] } } },
				textDocument: {
					documentSymbol: { hierarchicalDocumentSymbolSupport: true },
					references: {},
					rename: { prepareSupport: false },
				},
			},
			clientInfo: { name: "nklein-lsp-symbols", version: "1" },
		});
		await Promise.race([initialized, exited]);
		await connection.sendNotification("initialized", {});
		return new TypeScriptLspClient(child, connection);
	}

	async didOpen(uri: string, languageId: string, text: string): Promise<void> {
		await this.connection.sendNotification("textDocument/didOpen", {
			textDocument: { uri, languageId, version: 1, text },
		});
	}

	async didChange(uri: string, version: number, text: string): Promise<void> {
		await this.connection.sendNotification("textDocument/didChange", {
			textDocument: { uri, version },
			contentChanges: [{ text }],
		});
	}

	async documentSymbols(uri: string): Promise<LspDocumentSymbol[] | LspSymbolInformation[] | null> {
		return (await this.connection.sendRequest("textDocument/documentSymbol", { textDocument: { uri } })) as
			| LspDocumentSymbol[]
			| LspSymbolInformation[]
			| null;
	}

	async workspaceSymbols(query: string): Promise<LspSymbolInformation[] | null> {
		return (await this.connection.sendRequest("workspace/symbol", { query })) as LspSymbolInformation[] | null;
	}

	async references(uri: string, position: LspPosition): Promise<LspLocation[] | null> {
		return (await this.connection.sendRequest("textDocument/references", {
			textDocument: { uri },
			position,
			context: { includeDeclaration: true },
		})) as LspLocation[] | null;
	}

	async rename(uri: string, position: LspPosition, newName: string): Promise<LspWorkspaceEdit | null> {
		return (await this.connection.sendRequest("textDocument/rename", {
			textDocument: { uri },
			position,
			newName,
		})) as LspWorkspaceEdit | null;
	}

	async dispose(): Promise<void> {
		try {
			await this.connection.sendRequest("shutdown");
			await this.connection.sendNotification("exit");
		} finally {
			this.connection.dispose();
			if (!this.child.killed) this.child.kill("SIGTERM");
		}
	}
}

interface OpenDocument {
	absolutePath: string;
	relativePath: string;
	uri: string;
	text: string;
}

export class LspSymbolToolService {
	private readonly opened = new Map<string, { text: string; version: number }>();
	private workspacePrime: Promise<void> | null = null;

	constructor(
		private readonly root: string,
		private readonly client: LspProtocolClient,
	) {}

	private async open(relativePath: string): Promise<OpenDocument> {
		const absolutePath = await resolveExistingWorkspacePath(this.root, relativePath);
		const languageId = languageIdForPath(absolutePath);
		if (!languageId) throw new Error("The current LSP service supports TypeScript and JavaScript files only.");
		const text = await readFile(absolutePath, "utf8");
		const uri = pathToFileURL(absolutePath).href;
		const prior = this.opened.get(uri);
		if (!prior) {
			await this.client.didOpen(uri, languageId, text);
			this.opened.set(uri, { text, version: 1 });
		} else if (prior.text !== text) {
			const version = prior.version + 1;
			await this.client.didChange(uri, version, text);
			this.opened.set(uri, { text, version });
		}
		return { absolutePath, relativePath: relative(this.root, absolutePath), uri, text };
	}

	private async documentIndex(document: OpenDocument): Promise<IndexedDocumentSymbol[]> {
		const result = await this.client.documentSymbols(document.uri);
		if (!result?.length) return [];
		if (!isDocumentSymbol(result[0])) {
			return (result as LspSymbolInformation[]).map((symbol) => ({
				symbol: {
					name: symbol.name,
					kind: symbol.kind,
					range: symbol.location.range,
					selectionRange: symbol.location.range,
				},
				namePath: symbol.containerName ? `${symbol.containerName}/${symbol.name}` : symbol.name,
			}));
		}
		return indexDocumentSymbols(result as LspDocumentSymbol[]);
	}

	private async hasProjectConfig(startPath: string): Promise<boolean> {
		let directory = dirname(startPath);
		for (;;) {
			for (const configName of ["tsconfig.json", "jsconfig.json"]) {
				try {
					await access(join(directory, configName));
					return true;
				} catch {
					// Try the other config name / parent directory.
				}
			}
			if (directory === this.root) return false;
			const parent = dirname(directory);
			if (parent === directory) return false;
			assertInsideRoot(this.root, parent);
			directory = parent;
		}
	}

	private async primeWorkspaceSources(): Promise<void> {
		if (this.workspacePrime) return await this.workspacePrime;
		this.workspacePrime = (async () => {
			const queue = [this.root];
			const sourcePaths: string[] = [];
			const ignoredDirectories = new Set([
				".git",
				".next",
				".turbo",
				"build",
				"coverage",
				"dist",
				"node_modules",
				"target",
			]);
			while (queue.length > 0) {
				const directory = queue.shift() as string;
				const entries = (await readdir(directory, { withFileTypes: true })).sort((left, right) =>
					left.name.localeCompare(right.name),
				);
				for (const entry of entries) {
					if (entry.isSymbolicLink()) continue;
					const path = join(directory, entry.name);
					if (entry.isDirectory()) {
						if (!ignoredDirectories.has(entry.name)) queue.push(path);
						continue;
					}
					if (entry.isFile() && languageIdForPath(path)) sourcePaths.push(path);
					if (sourcePaths.length > 2_000) {
						throw new Error(
							"Workspace has no tsconfig/jsconfig and exceeds the 2,000-file inferred-project safety cap; add a project config so LSP references are complete.",
						);
					}
				}
			}
			let totalBytes = 0;
			for (const path of sourcePaths) {
				totalBytes += (await stat(path)).size;
				if (totalBytes > 32 * 1024 * 1024) {
					throw new Error(
						"Workspace has no tsconfig/jsconfig and exceeds the 32 MiB inferred-project safety cap; add a project config so LSP references are complete.",
					);
				}
				await this.open(relative(this.root, path));
			}
		})();
		return await this.workspacePrime;
	}

	private async ensureCompleteProjectContext(document: OpenDocument): Promise<void> {
		if (!(await this.hasProjectConfig(document.absolutePath))) await this.primeWorkspaceSources();
	}

	async getSymbolsOverview(input: { relativePath: string; depth?: number }): Promise<SymbolToolResult[]> {
		const document = await this.open(input.relativePath);
		const result = await this.client.documentSymbols(document.uri);
		if (!result?.length) return [];
		if (isDocumentSymbol(result[0])) {
			return indexDocumentSymbols(result as LspDocumentSymbol[], "", input.depth ?? 0).map(({ symbol, namePath }) =>
				compactDocumentSymbol(symbol, namePath, document.relativePath),
			);
		}
		return (result as LspSymbolInformation[]).map((symbol) => compactWorkspaceSymbol(symbol, this.root));
	}

	async findSymbol(input: {
		namePath: string;
		relativePath?: string;
		includeBody?: boolean;
		offset?: number;
		limit?: number;
	}): Promise<SymbolToolResult[]> {
		const offset = input.offset ?? 0;
		const limit = input.limit ?? 50;
		let results: SymbolToolResult[];
		if (input.relativePath) {
			const document = await this.open(input.relativePath);
			const index = await this.documentIndex(document);
			results = index
				.filter(({ namePath }) => namePathMatches(namePath, input.namePath))
				.map(({ symbol, namePath }) => compactDocumentSymbol(symbol, namePath, document.relativePath));
		} else {
			// workspace/symbol is only complete for configured projects after tsserver has discovered files. Opening the
			// bounded source set is deterministic and also makes unconfigured inferred projects complete.
			await this.primeWorkspaceSources();
			const symbols = await this.client.workspaceSymbols(leafName(input.namePath));
			results = (symbols ?? [])
				.filter(isSymbolInformation)
				.map((symbol) => compactWorkspaceSymbol(symbol, this.root))
				.filter((symbol) => namePathMatches(symbol.namePath, input.namePath));
		}
		const page = results.slice(offset, offset + limit);
		if (!input.includeBody) return page;
		return await Promise.all(
			page.map(async (symbol) => {
				const document = await this.open(symbol.relativePath);
				const start = positionToOffset(document.text, symbol.range.start);
				const end = positionToOffset(document.text, symbol.range.end);
				return { ...symbol, body: document.text.slice(start, end) };
			}),
		);
	}

	private async resolveUniqueSymbol(
		relativePath: string,
		namePath: string,
	): Promise<{
		document: OpenDocument;
		symbol: IndexedDocumentSymbol;
	}> {
		const document = await this.open(relativePath);
		const matches = (await this.documentIndex(document)).filter((candidate) =>
			namePathMatches(candidate.namePath, namePath),
		);
		if (matches.length === 0) throw new Error(`No symbol matching "${namePath}" exists in ${relativePath}.`);
		if (matches.length > 1) {
			throw new Error(
				`Symbol "${namePath}" is ambiguous in ${relativePath}; use an absolute name path such as /${matches[0]?.namePath}.`,
			);
		}
		return { document, symbol: matches[0] as IndexedDocumentSymbol };
	}

	async findReferencingSymbols(input: { relativePath: string; namePath: string; offset?: number; limit?: number }) {
		const resolved = await this.resolveUniqueSymbol(input.relativePath, input.namePath);
		await this.ensureCompleteProjectContext(resolved.document);
		const locations =
			(await this.client.references(resolved.document.uri, resolved.symbol.symbol.selectionRange.start)) ?? [];
		const results = locations.map((location) => {
			const absolutePath = fileURLToPath(location.uri);
			assertInsideRoot(this.root, absolutePath);
			return { relativePath: relative(this.root, absolutePath), range: location.range };
		});
		return results.slice(input.offset ?? 0, (input.offset ?? 0) + (input.limit ?? 100));
	}

	async renameSymbol(input: { relativePath: string; namePath: string; newName: string }) {
		if (!/^[\p{L}_$][\p{L}\p{N}_$]*$/u.test(input.newName)) {
			throw new Error(
				"newName must be a single identifier; the language server validates language-specific legality.",
			);
		}
		const resolved = await this.resolveUniqueSymbol(input.relativePath, input.namePath);
		await this.ensureCompleteProjectContext(resolved.document);
		const workspaceEdit = await this.client.rename(
			resolved.document.uri,
			resolved.symbol.symbol.selectionRange.start,
			input.newName,
		);
		if (!workspaceEdit) throw new Error("The language server declined this rename.");
		const edits = new Map<string, LspTextEdit[]>();
		for (const [uri, uriEdits] of Object.entries(workspaceEdit.changes ?? {})) edits.set(uri, [...uriEdits]);
		for (const change of workspaceEdit.documentChanges ?? []) {
			if (!("textDocument" in change)) {
				throw new Error(
					"Rename requires a file create/delete/rename operation, which this symbol-only tool refuses.",
				);
			}
			const returnedVersion = change.textDocument.version;
			if (typeof returnedVersion === "number") {
				const openedVersion = this.opened.get(change.textDocument.uri)?.version;
				if (openedVersion !== returnedVersion) {
					throw new Error(
						`Language server returned a stale document edit version (${returnedVersion}); expected ${openedVersion ?? "an unopened document"}.`,
					);
				}
			}
			const existing = edits.get(change.textDocument.uri) ?? [];
			edits.set(change.textDocument.uri, [...existing, ...change.edits]);
		}
		if (edits.size === 0) throw new Error("The language server returned an empty rename edit.");

		const planned: Array<{ absolutePath: string; original: string; updated: string; editCount: number }> = [];
		for (const [uri, fileEdits] of edits) {
			if (!uri.startsWith("file:")) throw new Error("Rename returned a non-file URI; refusing the edit.");
			const absolutePath = await realpath(fileURLToPath(uri));
			assertInsideRoot(this.root, absolutePath);
			const original = await readFile(absolutePath, "utf8");
			planned.push({
				absolutePath,
				original,
				updated: applyTextEdits(original, fileEdits),
				editCount: fileEdits.length,
			});
		}

		const written: typeof planned = [];
		try {
			for (const file of planned) {
				await writeFile(file.absolutePath, file.updated, "utf8");
				written.push(file);
			}
		} catch (error) {
			for (const file of written.reverse()) await writeFile(file.absolutePath, file.original, "utf8");
			throw error;
		}
		const syncWarnings: string[] = [];
		for (const file of planned) {
			const uri = pathToFileURL(file.absolutePath).href;
			const prior = this.opened.get(uri);
			if (!prior) continue;
			const version = prior.version + 1;
			try {
				await this.client.didChange(uri, version, file.updated);
				this.opened.set(uri, { text: file.updated, version });
			} catch (error) {
				// The rename is already durably applied. Retain the old open-document snapshot so the next tool call retries
				// a full-content didChange instead of falsely reporting that the refactor failed.
				syncWarnings.push(error instanceof Error ? error.message : String(error));
			}
		}
		return {
			oldNamePath: resolved.symbol.namePath,
			newName: input.newName,
			filesChanged: planned.length,
			editsApplied: planned.reduce((sum, file) => sum + file.editCount, 0),
			files: planned.map((file) => relative(this.root, file.absolutePath)),
			...(syncWarnings.length > 0
				? { warning: `Rename applied, but ${syncWarnings.length} language-server document sync(s) will retry.` }
				: {}),
		};
	}

	async dispose(): Promise<void> {
		await this.client.dispose();
	}
}

export async function createLspSymbolToolService(root = process.cwd()): Promise<LspSymbolToolService> {
	const canonicalRoot = await realpath(root);
	return new LspSymbolToolService(canonicalRoot, await TypeScriptLspClient.start(canonicalRoot));
}

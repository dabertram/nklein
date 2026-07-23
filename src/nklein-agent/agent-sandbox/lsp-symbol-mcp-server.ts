import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { createLspSymbolToolService } from "../lsp-symbol-tools";

const relativePath = z
	.string()
	.min(1)
	.describe("Workspace-relative path to a TypeScript/JavaScript, Python, Rust, Go, or Java file.");
const namePath = z
	.string()
	.min(1)
	.describe("Symbol name or slash-delimited name path, for example Widget/render; prefix / for an exact path.");
const offset = z.number().int().nonnegative().optional().describe("Zero-based result offset for pagination.");
const limit = z
	.number()
	.int()
	.min(1)
	.max(200)
	.optional()
	.describe("Maximum results to return (default depends on tool). Max 200.");

function textResult(value: unknown) {
	return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
}

function errorResult(error: unknown) {
	return {
		content: [{ type: "text" as const, text: error instanceof Error ? error.message : String(error) }],
		isError: true,
	};
}

async function main(): Promise<void> {
	const service = await createLspSymbolToolService();
	const server = new McpServer(
		{ name: "nklein-lsp-navigation", version: "2.0.0" },
		{
			instructions:
				"Use LSP navigation before grep/read_file when locating definitions and references. " +
				"After every successful edit to a supported source file, call get_diagnostics for that file before continuing. " +
				"Use rename_symbol only for semantic identifier renames; it applies the language server's complete WorkspaceEdit.",
		},
	);

	server.registerTool(
		"get_symbols_overview",
		{
			description: "Return a compact IDE/LSP outline for one supported source file without reading the whole file.",
			inputSchema: { relative_path: relativePath, depth: z.number().int().min(0).max(8).optional() },
		},
		async ({ relative_path, depth }) => {
			try {
				return textResult(await service.getSymbolsOverview({ relativePath: relative_path, depth }));
			} catch (error) {
				return errorResult(error);
			}
		},
	);

	server.registerTool(
		"find_symbol",
		{
			description:
				"Find symbols by semantic name path through the file's real language server. Restrict to a file when possible; include_body is opt-in.",
			inputSchema: {
				name_path: namePath,
				relative_path: relativePath.optional(),
				include_body: z.boolean().optional(),
				offset,
				limit,
			},
		},
		async ({ name_path, relative_path, include_body, offset, limit }) => {
			try {
				return textResult(
					await service.findSymbol({
						namePath: name_path,
						relativePath: relative_path,
						includeBody: include_body,
						offset,
						limit,
					}),
				);
			} catch (error) {
				return errorResult(error);
			}
		},
	);

	server.registerTool(
		"find_definition",
		{
			description:
				"Go to the semantic definition of the identifier at a zero-based line/character position using the file's language server.",
			inputSchema: {
				relative_path: relativePath,
				line: z.number().int().nonnegative().describe("Zero-based source line containing the identifier."),
				character: z.number().int().nonnegative().describe("Zero-based UTF-16 character offset on the line."),
				offset,
				limit,
			},
		},
		async ({ relative_path, line, character, offset, limit }) => {
			try {
				return textResult(
					await service.findDefinition({
						relativePath: relative_path,
						position: { line, character },
						offset,
						limit,
					}),
				);
			} catch (error) {
				return errorResult(error);
			}
		},
	);

	server.registerTool(
		"get_diagnostics",
		{
			description:
				"Synchronize one supported source file from disk and return bounded LSP errors, warnings, unused-code hints, and deprecations. Call after every successful edit.",
			inputSchema: {
				relative_path: relativePath,
				timeout_ms: z.number().int().min(50).max(10_000).optional(),
				offset,
				limit,
			},
		},
		async ({ relative_path, timeout_ms, offset, limit }) => {
			try {
				return textResult(
					await service.getDiagnostics({
						relativePath: relative_path,
						timeoutMs: timeout_ms,
						offset,
						limit,
					}),
				);
			} catch (error) {
				return errorResult(error);
			}
		},
	);

	server.registerTool(
		"find_referencing_symbols",
		{
			description:
				"Find declaration and usage locations for a symbol using LSP reference resolution rather than text matching.",
			inputSchema: { relative_path: relativePath, name_path: namePath, offset, limit },
		},
		async ({ relative_path, name_path, offset, limit }) => {
			try {
				return textResult(
					await service.findReferencingSymbols({
						relativePath: relative_path,
						namePath: name_path,
						offset,
						limit,
					}),
				);
			} catch (error) {
				return errorResult(error);
			}
		},
	);

	server.registerTool(
		"rename_symbol",
		{
			description:
				"Semantically rename one supported-language symbol across the sandbox workspace using the language server's WorkspaceEdit. Rejects file operations and out-of-workspace edits.",
			inputSchema: {
				relative_path: relativePath,
				name_path: namePath,
				new_name: z.string().min(1).describe("New identifier name."),
			},
		},
		async ({ relative_path, name_path, new_name }) => {
			try {
				return textResult(
					await service.renameSymbol({ relativePath: relative_path, namePath: name_path, newName: new_name }),
				);
			} catch (error) {
				return errorResult(error);
			}
		},
	);

	let disposing = false;
	async function dispose(): Promise<void> {
		if (disposing) return;
		disposing = true;
		await service.dispose();
	}
	const stop = () =>
		void dispose().finally(() => {
			process.exitCode = 0;
			process.stdin.destroy();
		});
	process.once("SIGTERM", stop);
	process.once("SIGINT", stop);

	await server.connect(new StdioServerTransport());
}

void main().catch((error: unknown) => {
	process.stderr.write(
		`nklein-lsp-symbols: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
	);
	process.exitCode = 1;
});

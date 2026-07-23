import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { createLspSymbolToolService } from "../lsp-symbol-tools";

const relativePath = z
	.string()
	.min(1)
	.describe("Workspace-relative path to a TypeScript or JavaScript file, for example src/app.ts.");
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
		{ name: "nklein-lsp-symbols", version: "1.0.0" },
		{
			instructions:
				"Use symbol tools before grep/read_file when locating TypeScript or JavaScript definitions and references. " +
				"Use rename_symbol only for semantic identifier renames; it applies the language server's complete WorkspaceEdit.",
		},
	);

	server.registerTool(
		"get_symbols_overview",
		{
			description:
				"Return a compact IDE/LSP outline for one TypeScript or JavaScript file without reading the whole file.",
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
				"Find TypeScript/JavaScript symbols by semantic name path through the real language server. Restrict to a file when possible; include_body is opt-in.",
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
				"Semantically rename one TypeScript/JavaScript symbol across the sandbox workspace using the language server's WorkspaceEdit. Rejects file operations and out-of-workspace edits.",
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

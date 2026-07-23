import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
	applyTextEdits,
	indexDocumentSymbols,
	type LspProtocolClient,
	LspSymbolToolService,
	namePathMatches,
	positionToOffset,
} from "../../../src/nklein-agent/lsp-symbol-tools";

const roots: string[] = [];

afterEach(async () => {
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("LSP symbol helpers", () => {
	it("indexes hierarchical document symbols with stable Serena-style name paths", () => {
		const indexed = indexDocumentSymbols([
			{
				name: "Widget",
				kind: 5,
				range: { start: { line: 0, character: 0 }, end: { line: 4, character: 1 } },
				selectionRange: { start: { line: 0, character: 6 }, end: { line: 0, character: 12 } },
				children: [
					{
						name: "render",
						kind: 6,
						range: { start: { line: 1, character: 1 }, end: { line: 3, character: 2 } },
						selectionRange: { start: { line: 1, character: 1 }, end: { line: 1, character: 7 } },
					},
				],
			},
		]);

		expect(indexed.map((entry) => entry.namePath)).toEqual(["Widget", "Widget/render"]);
		expect(namePathMatches("Widget/render", "render")).toBe(true);
		expect(namePathMatches("Widget/render", "Widget/render")).toBe(true);
		expect(namePathMatches("Other/render", "/Widget/render")).toBe(false);
	});

	it("applies non-overlapping LSP edits in reverse order and honours UTF-16 character offsets", () => {
		const source = "const smile = '😀';\nsmile();\n";
		expect(positionToOffset(source, { line: 0, character: 18 })).toBe(18);
		expect(
			applyTextEdits(source, [
				{ range: { start: { line: 0, character: 6 }, end: { line: 0, character: 11 } }, newText: "grin" },
				{ range: { start: { line: 1, character: 0 }, end: { line: 1, character: 5 } }, newText: "grin" },
			]),
		).toBe("const grin = '😀';\ngrin();\n");
	});

	it("rejects overlapping or out-of-range language-server edits", () => {
		expect(() =>
			applyTextEdits("abcdef", [
				{ range: { start: { line: 0, character: 1 }, end: { line: 0, character: 4 } }, newText: "x" },
				{ range: { start: { line: 0, character: 3 }, end: { line: 0, character: 5 } }, newText: "y" },
			]),
		).toThrow(/overlapping/);
		expect(() => positionToOffset("x", { line: 2, character: 0 })).toThrow(/outside/);
	});
});

describe("LspSymbolToolService", () => {
	it("returns compact symbols/references and applies a complete semantic rename edit", async () => {
		const root = await mkdtemp(join(tmpdir(), "nklein-lsp-symbols-"));
		roots.push(root);
		const relativePath = "sample.ts";
		const absolutePath = join(root, relativePath);
		await writeFile(absolutePath, "export function alpha() {}\nexport const use = alpha;\n", "utf8");
		const canonicalRoot = await realpath(root);
		const uri = pathToFileURL(join(canonicalRoot, relativePath)).href;
		const notifications: Array<{ kind: string; version?: number }> = [];
		const client = {
			async didOpen() {
				notifications.push({ kind: "open" });
			},
			async didChange(_uri: string, version: number) {
				notifications.push({ kind: "change", version });
			},
			async documentSymbols() {
				return [
					{
						name: "alpha",
						kind: 12,
						range: { start: { line: 0, character: 0 }, end: { line: 0, character: 26 } },
						selectionRange: { start: { line: 0, character: 16 }, end: { line: 0, character: 21 } },
					},
				];
			},
			async workspaceSymbols() {
				return [];
			},
			async references() {
				return [
					{ uri, range: { start: { line: 0, character: 16 }, end: { line: 0, character: 21 } } },
					{ uri, range: { start: { line: 1, character: 19 }, end: { line: 1, character: 24 } } },
				];
			},
			async rename() {
				return {
					changes: {
						[uri]: [
							{
								range: { start: { line: 0, character: 16 }, end: { line: 0, character: 21 } },
								newText: "beta",
							},
							{
								range: { start: { line: 1, character: 19 }, end: { line: 1, character: 24 } },
								newText: "beta",
							},
						],
					},
				};
			},
			async dispose() {},
		} satisfies LspProtocolClient;
		const service = new LspSymbolToolService(canonicalRoot, client);

		await expect(service.getSymbolsOverview({ relativePath })).resolves.toMatchObject([
			{ name: "alpha", namePath: "alpha", kind: "Function", relativePath },
		]);
		await expect(service.findReferencingSymbols({ relativePath, namePath: "alpha" })).resolves.toHaveLength(2);
		await expect(service.renameSymbol({ relativePath, namePath: "alpha", newName: "beta" })).resolves.toMatchObject({
			filesChanged: 1,
			editsApplied: 2,
		});
		expect(await readFile(absolutePath, "utf8")).toBe("export function beta() {}\nexport const use = beta;\n");
		expect(notifications).toEqual([{ kind: "open" }, { kind: "change", version: 2 }]);
	});

	it("refuses resource operations and leaves the workspace untouched", async () => {
		const root = await mkdtemp(join(tmpdir(), "nklein-lsp-symbols-"));
		roots.push(root);
		const relativePath = "sample.ts";
		const absolutePath = join(root, relativePath);
		await writeFile(absolutePath, "const alpha = 1;\n", "utf8");
		const client = {
			async didOpen() {},
			async didChange() {},
			async documentSymbols() {
				return [
					{
						name: "alpha",
						kind: 13,
						range: { start: { line: 0, character: 0 }, end: { line: 0, character: 16 } },
						selectionRange: { start: { line: 0, character: 6 }, end: { line: 0, character: 11 } },
					},
				];
			},
			async workspaceSymbols() {
				return [];
			},
			async references() {
				return [];
			},
			async rename() {
				return { documentChanges: [{ kind: "rename", oldUri: "file:///a", newUri: "file:///b" }] };
			},
			async dispose() {},
		} satisfies LspProtocolClient;
		const service = new LspSymbolToolService(await realpath(root), client);

		await expect(service.renameSymbol({ relativePath, namePath: "alpha", newName: "beta" })).rejects.toThrow(
			/file create\/delete\/rename/,
		);
		expect(await readFile(absolutePath, "utf8")).toBe("const alpha = 1;\n");
	});

	it("refuses stale versioned WorkspaceEdits before writing", async () => {
		const root = await mkdtemp(join(tmpdir(), "nklein-lsp-symbols-"));
		roots.push(root);
		const relativePath = "sample.ts";
		const absolutePath = join(root, relativePath);
		await writeFile(absolutePath, "const alpha = 1;\n", "utf8");
		const uri = pathToFileURL(await realpath(absolutePath)).href;
		const client = {
			async didOpen() {},
			async didChange() {},
			async documentSymbols() {
				return [
					{
						name: "alpha",
						kind: 13,
						range: { start: { line: 0, character: 0 }, end: { line: 0, character: 16 } },
						selectionRange: { start: { line: 0, character: 6 }, end: { line: 0, character: 11 } },
					},
				];
			},
			async workspaceSymbols() {
				return [];
			},
			async references() {
				return [];
			},
			async rename() {
				return {
					documentChanges: [
						{
							textDocument: { uri, version: 9 },
							edits: [
								{
									range: { start: { line: 0, character: 6 }, end: { line: 0, character: 11 } },
									newText: "beta",
								},
							],
						},
					],
				};
			},
			async dispose() {},
		} satisfies LspProtocolClient;
		const service = new LspSymbolToolService(await realpath(root), client);

		await expect(service.renameSymbol({ relativePath, namePath: "alpha", newName: "beta" })).rejects.toThrow(
			/stale document edit version/,
		);
		expect(await readFile(absolutePath, "utf8")).toBe("const alpha = 1;\n");
	});
});

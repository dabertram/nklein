import { describe, expect, it } from "vitest";
import { type LocalizationHit, localizationProviderAsKernelLocalize } from "../../../src/core/localization-provider";
import {
	createMcpLocalizationProvider,
	type McpToolCaller,
	SEARCH_GRAPH_TOOL,
} from "../../../src/core/mcp-localization-provider";

/**
 * A recording fake `callMcpTool`: returns `canned` for `search_graph` (regardless of args), and records every
 * `(toolName, args)` it was invoked with so tests can assert the wiring. Non-search tools return `undefined`.
 */
function fakeCaller(canned: unknown): {
	call: McpToolCaller;
	calls: Array<{ tool: string; args: Record<string, unknown> }>;
} {
	const calls: Array<{ tool: string; args: Record<string, unknown> }> = [];
	const call: McpToolCaller = async (tool, args) => {
		calls.push({ tool, args });
		return tool === SEARCH_GRAPH_TOOL ? canned : undefined;
	};
	return { call, calls };
}

/** A representative `search_graph` node as documented (name/label/qualified_name/file/start_line/end_line/score). */
const CANNED_RESULTS = {
	results: [
		{
			name: "handleRequest",
			label: "Function",
			qualified_name: "svc.http.handleRequest",
			file: "src/http/server.ts",
			start_line: 42,
			end_line: 87,
			score: 0.91,
		},
		{
			name: "RequestHandler",
			label: "Class",
			qualified_name: "svc.http.RequestHandler",
			file: "src/http/handler.ts",
			start_line: 10,
			end_line: 10,
			score: 0.4,
		},
	],
};

describe("createMcpLocalizationProvider — search_graph mapping", () => {
	it("maps a canned search_graph result into LocalizationHits (file/symbol/span/score/reason)", async () => {
		const { call } = fakeCaller(CANNED_RESULTS);
		const provider = createMcpLocalizationProvider(call);

		const hits = await provider.localize({ query: ".*Handler.*" });

		expect(hits).toEqual<LocalizationHit[]>([
			{
				file: "src/http/server.ts",
				symbol: "handleRequest",
				startLine: 42,
				endLine: 87,
				score: 0.91,
				reason: "Function `handleRequest` from search_graph",
			},
			{
				file: "src/http/handler.ts",
				symbol: "RequestHandler",
				startLine: 10,
				// end_line == start_line: kept on the hit; the ref layer (localizationHitToRef) is what collapses it.
				endLine: 10,
				score: 0.4,
				reason: "Class `RequestHandler` from search_graph",
			},
		]);
	});

	it("derives the symbol from qualified_name when `name` is absent", async () => {
		const { call } = fakeCaller({
			results: [{ qualified_name: "proj.pkg.Widget.render", file: "src/widget.ts", start_line: 5 }],
		});
		const provider = createMcpLocalizationProvider(call);

		const hits = await provider.localize({ query: "render" });
		expect(hits).toEqual<LocalizationHit[]>([
			{ file: "src/widget.ts", symbol: "render", startLine: 5, reason: "symbol `render` from search_graph" },
		]);
	});

	it("tolerates a bare-array envelope (no `results` wrapper)", async () => {
		const { call } = fakeCaller([{ name: "boom", label: "Function", file: "src/a.ts" }]);
		const provider = createMcpLocalizationProvider(call);

		const hits = await provider.localize({ query: "boom" });
		expect(hits).toEqual<LocalizationHit[]>([
			{ file: "src/a.ts", symbol: "boom", reason: "Function `boom` from search_graph" },
		]);
	});

	it("tolerates the real MCP text-content envelope and file_path field", async () => {
		const { call } = fakeCaller({
			content: [
				{
					type: "text",
					text: JSON.stringify({
						total: 1,
						results: [
							{
								name: "handleRequest",
								qualified_name: "workspaces-probe.src.server.handleRequest",
								label: "Function",
								file_path: "src/server.ts",
							},
						],
						has_more: false,
					}),
				},
			],
		});
		const provider = createMcpLocalizationProvider(call);

		const hits = await provider.localize({ query: ".*handleRequest.*" });

		expect(hits).toEqual<LocalizationHit[]>([
			{
				file: "src/server.ts",
				symbol: "handleRequest",
				reason: "Function `handleRequest` from search_graph",
			},
		]);
	});

	it("tolerates structuredContent wrappers", async () => {
		const { call } = fakeCaller({
			structuredContent: {
				results: [{ name: "run", label: "Function", file_path: "src/app.ts" }],
			},
		});

		const hits = await createMcpLocalizationProvider(call).localize({ query: "run" });

		expect(hits).toEqual<LocalizationHit[]>([
			{ file: "src/app.ts", symbol: "run", reason: "Function `run` from search_graph" },
		]);
	});
});

describe("createMcpLocalizationProvider — tool wiring / args", () => {
	it("calls search_graph with query→name_pattern and maxHits→limit", async () => {
		const { call, calls } = fakeCaller(CANNED_RESULTS);
		const provider = createMcpLocalizationProvider(call);

		await provider.localize({ query: ".*Handler.*", maxHits: 5 });

		expect(calls).toHaveLength(1);
		expect(calls[0]?.tool).toBe("search_graph");
		expect(calls[0]?.args).toEqual({ name_pattern: ".*Handler.*", limit: 5 });
	});

	it("omits `limit` when maxHits is unset and forwards scoping options", async () => {
		const { call, calls } = fakeCaller(CANNED_RESULTS);
		const provider = createMcpLocalizationProvider(call, {
			project: "kanban",
			label: "Function",
			filePattern: "src/**",
		});

		await provider.localize({ query: "handle" });

		expect(calls[0]?.args).toEqual({
			name_pattern: "handle",
			label: "Function",
			file_pattern: "src/**",
			project: "kanban",
		});
		expect(calls[0]?.args).not.toHaveProperty("limit");
	});

	it("caps the returned hits at maxHits even if the tool over-returns", async () => {
		const { call } = fakeCaller(CANNED_RESULTS); // 2 nodes
		const provider = createMcpLocalizationProvider(call);

		const hits = await provider.localize({ query: ".*", maxHits: 1 });
		expect(hits).toHaveLength(1);
		expect(hits[0]?.file).toBe("src/http/server.ts");
	});

	it("does not call the tool for a blank query", async () => {
		const { call, calls } = fakeCaller(CANNED_RESULTS);
		const provider = createMcpLocalizationProvider(call);

		expect(await provider.localize({ query: "   " })).toEqual([]);
		expect(calls).toHaveLength(0);
	});
});

describe("createMcpLocalizationProvider — defensive (malformed / empty → [], never throws)", () => {
	it("returns [] for an empty result set", async () => {
		const { call } = fakeCaller({ results: [] });
		expect(await createMcpLocalizationProvider(call).localize({ query: "x" })).toEqual([]);
	});

	it("returns [] when the result is not a recognized shape (string / number / null)", async () => {
		for (const junk of ["not json", 42, null, undefined, true]) {
			const { call } = fakeCaller(junk);
			expect(await createMcpLocalizationProvider(call).localize({ query: "x" })).toEqual([]);
		}
	});

	it("skips nodes that are not objects or lack a file path, keeping the good ones", async () => {
		const { call } = fakeCaller({
			results: [
				"garbage",
				42,
				null,
				{ name: "noFile", label: "Function" }, // no file → skipped
				{ file: "", name: "blankFile" }, // blank file → skipped
				{ name: "good", label: "Function", file: "src/good.ts" }, // kept
			],
		});
		const hits = await createMcpLocalizationProvider(call).localize({ query: "x" });
		expect(hits).toEqual<LocalizationHit[]>([
			{ file: "src/good.ts", symbol: "good", reason: "Function `good` from search_graph" },
		]);
	});

	it("drops non-numeric/invalid lines and scores rather than emitting garbage", async () => {
		const { call } = fakeCaller({
			results: [
				{
					name: "weird",
					file: "src/w.ts",
					start_line: "nope",
					end_line: 3,
					score: "high",
				},
				{
					name: "badspan",
					file: "src/b.ts",
					start_line: 20,
					end_line: 5, // end < start → dropped, start kept
					score: Number.NaN, // not finite → dropped
				},
			],
		});
		const hits = await createMcpLocalizationProvider(call).localize({ query: "x" });
		expect(hits).toEqual<LocalizationHit[]>([
			{ file: "src/w.ts", symbol: "weird", reason: "symbol `weird` from search_graph" },
			{ file: "src/b.ts", symbol: "badspan", startLine: 20, reason: "symbol `badspan` from search_graph" },
		]);
	});

	it("returns [] (does not throw) when the tool call rejects", async () => {
		const throwing: McpToolCaller = async () => {
			throw new Error("mcp transport down");
		};
		await expect(createMcpLocalizationProvider(throwing).localize({ query: "x" })).resolves.toEqual([]);
	});
});

describe("createMcpLocalizationProvider — composes with the kernel localize adapter", () => {
	it("feeds localizationProviderAsKernelLocalize with ranked, de-duped refs", async () => {
		const { call } = fakeCaller(CANNED_RESULTS);
		const provider = createMcpLocalizationProvider(call);

		// server.ts@0.91 ranks above handler.ts@0.4; both prefer the symbol form.
		const localize = localizationProviderAsKernelLocalize(provider, { query: ".*Handler.*" });
		expect(await localize()).toEqual(["src/http/server.ts:handleRequest", "src/http/handler.ts:RequestHandler"]);
	});
});

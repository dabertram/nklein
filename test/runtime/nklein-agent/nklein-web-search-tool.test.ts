import { describe, expect, it, vi } from "vitest";
import type { WebSearchError, WebSearchResponse } from "../../../src/core/web-search-contract";
import { createNKleinWebSearchTool } from "../../../src/nklein-agent/nklein-web-search-tool";

function createTool(outcome: WebSearchResponse | WebSearchError) {
	const search = vi.fn(async (_query: string) => outcome);
	const tool = createNKleinWebSearchTool({ search });
	return { tool, search };
}

describe("web_search tool", () => {
	it("declares the egress-gated tool contract (name + strict single-query schema)", () => {
		const { tool } = createTool({ query: "q", results: [] });
		expect(tool.name).toBe("web_search");
		expect(tool.inputSchema).toMatchObject({
			type: "object",
			required: ["query"],
			additionalProperties: false,
		});
		expect((tool.inputSchema.properties as { query: { type: string } }).query.type).toBe("string");
	});

	it("returns ok with the echoed query and results on success", async () => {
		const response: WebSearchResponse = {
			query: "searxng json api",
			results: [{ title: "SearXNG docs", url: "https://docs.searxng.org", snippet: "Search API", source: "docs" }],
		};
		const { tool, search } = createTool(response);
		const output = await tool.execute({ query: "searxng json api" }, undefined as never);
		expect(search).toHaveBeenCalledWith("searxng json api");
		expect(output).toEqual({ ok: true, query: "searxng json api", results: response.results });
	});

	it.each([
		["blocked_by_egress", /disabled for this workspace.*continue without web results/i],
		["no_backend", /no search backend.*continue without web results/i],
		["backend_error", /retry once|continue without web results/i],
		["empty_query", /call web_search again.*non-empty query/i],
	] as const)("maps the %s error to ok:false with an actionable instruction", async (code, instructionPattern) => {
		const { tool } = createTool({ code, message: `upstream ${code}` });
		const output = await tool.execute({ query: "anything" }, undefined as never);
		expect(output).toMatchObject({ ok: false, error: code });
		expect((output as { instruction: string }).instruction).toMatch(instructionPattern);
	});

	it("never throws when the injected search rejects (contract violation degrades to backend_error)", async () => {
		const tool = createNKleinWebSearchTool({
			search: async () => {
				throw new Error("socket exploded");
			},
		});
		const output = await tool.execute({ query: "boom" }, undefined as never);
		expect(output).toMatchObject({ ok: false, error: "backend_error" });
		expect((output as { instruction: string }).instruction.length).toBeGreaterThan(0);
	});

	it("coerces malformed input (missing/non-string query) to an empty query instead of throwing", async () => {
		const emptyQueryError: WebSearchError = { code: "empty_query", message: "blank" };
		const { tool, search } = createTool(emptyQueryError);
		await expect(tool.execute({}, undefined as never)).resolves.toMatchObject({ ok: false, error: "empty_query" });
		await expect(tool.execute({ query: 42 }, undefined as never)).resolves.toMatchObject({ ok: false });
		await expect(tool.execute(null, undefined as never)).resolves.toMatchObject({ ok: false });
		expect(search).toHaveBeenCalledWith("");
	});
});

import { describe, expect, it, vi } from "vitest";
import { createWebResearchTool, runWebResearchFetch } from "../../../src/nklein-agent/nklein-web-research-tool";

function createResponse(body: string, options: { contentType?: string; ok?: boolean; status?: number } = {}): Response {
	return new Response(body, {
		status: options.status ?? (options.ok === false ? 500 : 200),
		headers: {
			"content-type": options.contentType ?? "text/html",
		},
	});
}

describe("nklein web research tool", () => {
	it("is disabled by default", () => {
		expect(createWebResearchTool()).toEqual([]);
	});

	it("blocks non-HTTPS and non-allow-listed sources", async () => {
		await expect(runWebResearchFetch({ url: "http://docs.nklein.bot" })).rejects.toThrow("HTTPS");
		await expect(runWebResearchFetch({ url: "https://example.com" })).rejects.toThrow("allow-list");
	});

	it("fetches and compresses allow-listed HTML", async () => {
		const fetch = vi.fn(async () =>
			createResponse(
				"<html><head><title>Docs</title></head><body><script>bad()</script><h1>Hello</h1></body></html>",
			),
		) as unknown as typeof globalThis.fetch;

		const result = await runWebResearchFetch({
			url: "https://docs.nklein.bot/sdk/overview",
			fetch,
			maxChars: 20,
		});

		expect(result).toMatchObject({
			title: "Docs",
			content: "Docs Hello",
			truncated: false,
			sourceDomain: "docs.nklein.bot",
		});
		expect(fetch).toHaveBeenCalled();
	});

	it("creates an executable AgentTool when enabled", async () => {
		const fetch = vi.fn(async () =>
			createResponse("Fresh model data", { contentType: "text/plain" }),
		) as unknown as typeof globalThis.fetch;
		const [tool] = createWebResearchTool({ enabled: true, fetch, allowedDomains: ["openrouter.ai"] });
		if (!tool) {
			throw new Error("Expected web research tool to be created.");
		}

		await expect(
			tool.execute({ url: "https://openrouter.ai/models" }, {} as Parameters<typeof tool.execute>[1]),
		).resolves.toMatchObject({
			content: "Fresh model data",
			sourceDomain: "openrouter.ai",
		});
	});
});

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

	it("retries a transient fetch failure then succeeds (§5.AF transient survivability)", async () => {
		let calls = 0;
		const fetch = vi.fn(async () => {
			calls += 1;
			if (calls === 1) {
				throw new Error("Body Timeout Error");
			}
			return createResponse("Recovered", { contentType: "text/plain" });
		}) as unknown as typeof globalThis.fetch;

		const result = await runWebResearchFetch({ url: "https://docs.nklein.bot/x", fetch });
		expect(result.content).toBe("Recovered");
		expect(calls).toBe(2); // 1 transient throw + 1 success
	});

	it("does NOT retry a non-transient 404 (a 4xx is a real failure)", async () => {
		const fetch = vi.fn(async () =>
			createResponse("nope", { status: 404, ok: false }),
		) as unknown as typeof globalThis.fetch;
		await expect(runWebResearchFetch({ url: "https://docs.nklein.bot/missing", fetch })).rejects.toThrow("HTTP 404");
		expect(fetch).toHaveBeenCalledTimes(1);
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
describe("freshness advisory (F4.2)", () => {
	it("appends the gate's reason to the tool description; absent advisory leaves it unchanged", () => {
		const [plain] = createWebResearchTool({ enabled: true });
		const [advised] = createWebResearchTool({
			enabled: true,
			freshnessAdvisory: "Local knowledge is stale for this fast-moving topic — refreshing online first.",
		});
		expect(plain?.description).not.toContain("Freshness gate:");
		expect(advised?.description).toContain("Freshness gate: Local knowledge is stale");
	});
});

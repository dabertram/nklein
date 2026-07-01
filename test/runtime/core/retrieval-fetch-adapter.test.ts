import { describe, expect, it } from "vitest";
import { browserFetchAdapter, type PageFetcher } from "../../../src/core/retrieval-fetch-adapter";
import type { RetrievalHit } from "../../../src/core/retrieval-loop-driver";

const hit = (over: Partial<RetrievalHit> = {}): RetrievalHit => ({ id: "h1", url: "https://example.com/a", ...over });

describe("browserFetchAdapter", () => {
	it("fetches the hit URL and prepends the page title to the body text", async () => {
		const fetchPage: PageFetcher = async (url) => ({ url, title: "Release Notes", text: "v2 ships today." });
		const evidence = await browserFetchAdapter(fetchPage)(hit());
		expect(evidence.id).toBe("h1");
		expect(evidence.text).toBe("Release Notes\n\nv2 ships today.");
		expect(evidence.url).toBe("https://example.com/a");
	});

	it("carries the hit's publishedAt + sourceType through (the page has no date)", async () => {
		const fetchPage: PageFetcher = async (url) => ({ url, title: "", text: "body" });
		const evidence = await browserFetchAdapter(fetchPage)(hit({ publishedAt: "2026-06-01", sourceType: "doc" }));
		expect(evidence.publishedAt).toBe("2026-06-01");
		expect(evidence.sourceType).toBe("doc");
	});

	it("uses body text alone when the page has no title", async () => {
		const fetchPage: PageFetcher = async (url) => ({ url, title: "   ", text: "just body" });
		const evidence = await browserFetchAdapter(fetchPage)(hit());
		expect(evidence.text).toBe("just body");
	});

	it("prefers the final (post-redirect) URL returned by the fetcher", async () => {
		const fetchPage: PageFetcher = async () => ({ url: "https://example.com/final", title: "T", text: "b" });
		const evidence = await browserFetchAdapter(fetchPage)(hit({ url: "https://example.com/start" }));
		expect(evidence.url).toBe("https://example.com/final");
	});

	it("rejects a hit with no URL (the driver treats a rejected fetch as a skip)", async () => {
		const fetchPage: PageFetcher = async (url) => ({ url, title: "T", text: "b" });
		await expect(browserFetchAdapter(fetchPage)(hit({ url: undefined }))).rejects.toThrow(/no URL/i);
	});

	it("does not swallow the fetcher's own rejection (egress error propagates to the driver's skip path)", async () => {
		const fetchPage: PageFetcher = async () => {
			throw new Error("SSRF blocked");
		};
		await expect(browserFetchAdapter(fetchPage)(hit())).rejects.toThrow(/SSRF blocked/);
	});
});

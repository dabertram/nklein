import { describe, expect, it, vi } from "vitest";
import { buildSsrfGuardedPageFetcher } from "../../../src/chat/chat-browser-tool";

// Regression fence for the §5.AC retrieval-loop SSRF fix: the retrieval loop fetches untrusted, backend/SEO-
// controllable result URLs, so its fetch dep MUST be SSRF-guarded. buildSsrfGuardedPageFetcher is the centralized
// guard the loop is wired through (chat-browser-tool). Before the fix the loop wired the RAW fetcher and had NO guard,
// so a result URL could navigate the host browser to loopback/LAN/link-local/cloud-metadata. Literal IPs are used so
// checkHostForSsrf runs synchronously (ipaddr.isValid branch) without any DNS.
describe("buildSsrfGuardedPageFetcher — SSRF floor around the retrieval-loop fetch", () => {
	it("refuses a link-local (cloud-metadata) URL and never calls the underlying fetcher", async () => {
		const fetchPage = vi.fn(async (url: string) => ({ url, title: "t", text: "iam-credentials" }));
		const fetch = buildSsrfGuardedPageFetcher({ fetchPage });
		await expect(fetch("http://169.254.169.254/latest/meta-data/iam/security-credentials/")).rejects.toThrow();
		expect(fetchPage).not.toHaveBeenCalled();
	});

	it("refuses loopback and private literal-IP URLs before fetching", async () => {
		const fetchPage = vi.fn(async (url: string) => ({ url, title: "t", text: "internal" }));
		const fetch = buildSsrfGuardedPageFetcher({ fetchPage });
		await expect(fetch("http://127.0.0.1:11434/")).rejects.toThrow();
		await expect(fetch("http://192.168.1.1/")).rejects.toThrow();
		await expect(fetch("http://10.0.0.5/admin")).rejects.toThrow();
		expect(fetchPage).not.toHaveBeenCalled();
	});

	it("refuses a non-http(s) URL (file://) before fetching", async () => {
		const fetchPage = vi.fn(async (url: string) => ({ url, title: "t", text: "etc-passwd" }));
		const fetch = buildSsrfGuardedPageFetcher({ fetchPage });
		await expect(fetch("file:///etc/passwd")).rejects.toThrow();
		expect(fetchPage).not.toHaveBeenCalled();
	});

	it("refuses a public URL that REDIRECTS to an internal address (post-redirect re-check)", async () => {
		// Public pre-fetch host passes, but the fetched page's final URL is loopback → must be refused.
		const fetchPage = vi.fn(async () => ({ url: "http://127.0.0.1:8080/", title: "t", text: "internal" }));
		const fetch = buildSsrfGuardedPageFetcher({ fetchPage });
		await expect(fetch("http://8.8.8.8/")).rejects.toThrow();
		expect(fetchPage).toHaveBeenCalledTimes(1);
	});

	it("allows a public URL and returns the fetched page", async () => {
		const fetchPage = vi.fn(async (url: string) => ({ url, title: "Example", text: "hello" }));
		const fetch = buildSsrfGuardedPageFetcher({ fetchPage });
		const page = await fetch("http://8.8.8.8/");
		expect(page).toEqual({ url: "http://8.8.8.8/", title: "Example", text: "hello" });
		expect(fetchPage).toHaveBeenCalledTimes(1);
	});
});

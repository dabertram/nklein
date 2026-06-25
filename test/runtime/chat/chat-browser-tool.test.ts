import { describe, expect, it, vi } from "vitest";
import { type BrowserDeps, type BrowserFetchResult, createBrowserTools } from "../../../src/chat/chat-browser-tool";

/** Create a fake `BrowserDeps` that resolves to a fixed result. */
function fakeBrowser(result: BrowserFetchResult): BrowserDeps {
	return { fetchPage: vi.fn(async () => result) };
}

/** Extract the `browse_url` tool from the set. */
function getBrowseTool(browser: BrowserDeps, maxChars?: number) {
	const { tools } = createBrowserTools({ browser, ...(maxChars !== undefined ? { maxChars } : {}) });
	const found = tools.find((candidate) => candidate.name === "browse_url");
	if (!found) {
		throw new Error("browse_url tool missing");
	}
	return found;
}

describe("createBrowserTools — browse_url", () => {
	it("is a host_command action (gated by the execution-mode policy)", () => {
		const { tools } = createBrowserTools({ browser: fakeBrowser({ url: "https://x.com", title: "", text: "" }) });
		expect(tools[0]?.actionKind).toBe("host_command");
	});

	it("returns the page title and text for a successful fetch", async () => {
		const browser = fakeBrowser({ url: "https://example.com", title: "Example Domain", text: "Hello world." });
		const out = await getBrowseTool(browser).run({ url: "https://example.com" });
		expect(out).toContain("Title: Example Domain");
		expect(out).toContain("Hello world.");
		expect(out).toContain("URL: https://example.com");
	});

	it("calls fetchPage with the validated URL", async () => {
		const browser = fakeBrowser({ url: "https://example.com/page", title: "T", text: "body" });
		await getBrowseTool(browser).run({ url: "https://example.com/page" });
		expect(browser.fetchPage).toHaveBeenCalledWith("https://example.com/page");
	});

	it("truncates long page text and appends a truncation note", async () => {
		const huge = "x".repeat(20_000);
		const browser = fakeBrowser({ url: "https://big.example.com", title: "Big", text: huge });
		const out = await getBrowseTool(browser, 500).run({ url: "https://big.example.com" });
		expect(out).toContain("[truncated:");
		// The full text must not appear (only up to maxChars + framing)
		expect(out.length).toBeLessThan(1_000);
	});

	it("does not truncate text that fits within the cap", async () => {
		const text = "Short text.";
		const browser = fakeBrowser({ url: "https://short.example.com", title: "Short", text });
		const out = await getBrowseTool(browser, 8_000).run({ url: "https://short.example.com" });
		expect(out).toContain("Short text.");
		expect(out).not.toContain("[truncated:");
	});

	it("rejects a non-http(s) URL without calling fetchPage", async () => {
		const browser = fakeBrowser({ url: "ftp://example.com", title: "", text: "" });
		const out = await getBrowseTool(browser).run({ url: "ftp://example.com" });
		expect(out).toContain("Only http:// and https://");
		expect(browser.fetchPage).not.toHaveBeenCalled();
	});

	it("rejects a file:// URL without calling fetchPage", async () => {
		const browser = fakeBrowser({ url: "file:///etc/passwd", title: "", text: "" });
		const out = await getBrowseTool(browser).run({ url: "file:///etc/passwd" });
		expect(out).toContain("Only http:// and https://");
		expect(browser.fetchPage).not.toHaveBeenCalled();
	});

	it("rejects a missing/empty url argument without calling fetchPage", async () => {
		const browser = fakeBrowser({ url: "", title: "", text: "" });
		const outMissing = await getBrowseTool(browser).run({});
		expect(outMissing).toBe("Provide a `url` string to browse.");
		expect(browser.fetchPage).not.toHaveBeenCalled();

		const outEmpty = await getBrowseTool(browser).run({ url: "   " });
		expect(outEmpty).toBe("Provide a `url` string to browse.");
		expect(browser.fetchPage).not.toHaveBeenCalled();
	});

	it("rejects a syntactically invalid URL without calling fetchPage", async () => {
		const browser = fakeBrowser({ url: "", title: "", text: "" });
		const out = await getBrowseTool(browser).run({ url: "not a url at all" });
		expect(out).toContain("Invalid URL:");
		expect(browser.fetchPage).not.toHaveBeenCalled();
	});

	it("returns a safe message when fetchPage throws — no stack or host path leaked", async () => {
		const throws: BrowserDeps = {
			fetchPage: async () => {
				throw new Error("/private/var/folders/secret/host-path timeout");
			},
		};
		const out = await getBrowseTool(throws).run({ url: "https://unreachable.example.com" });
		expect(out).toContain("Could not load the page");
		expect(out).not.toContain("/private/var");
		expect(out).not.toContain("Error:");
		expect(out).not.toContain("at ");
	});

	it("reports (no title) for a page with an empty title", async () => {
		const browser = fakeBrowser({ url: "https://notitle.example.com", title: "", text: "content" });
		const out = await getBrowseTool(browser).run({ url: "https://notitle.example.com" });
		expect(out).toContain("Title: (no title)");
	});

	it("reports (no text content) for a page with no body text", async () => {
		const browser = fakeBrowser({ url: "https://empty.example.com", title: "Empty", text: "   " });
		const out = await getBrowseTool(browser).run({ url: "https://empty.example.com" });
		expect(out).toContain("(no text content)");
	});

	it("exposes the correct tool name and description to the model, without leaking concrete browsed URLs", () => {
		const { definitions } = createBrowserTools({
			browser: fakeBrowser({ url: "https://secret.internal/", title: "", text: "" }),
		});
		// The definition must not contain any concretely-browsed URL
		const json = JSON.stringify(definitions);
		expect(json).not.toContain("secret.internal");
		expect(definitions[0]?.name).toBe("browse_url");
		expect(typeof definitions[0]?.description).toBe("string");
	});
});

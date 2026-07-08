import { describe, expect, it, vi } from "vitest";
import {
	type BrowserDeps,
	type BrowserFetchResult,
	createBrowserTools,
	isPrivateOrReservedIp,
} from "../../../src/chat/chat-browser-tool";

/** Create a fake `BrowserDeps` that resolves to a fixed result. */
function fakeBrowser(result: BrowserFetchResult): BrowserDeps {
	return { fetchPage: vi.fn(async () => result) };
}

/** Extract the `browse_url` tool from the set. */
function getBrowseTool(browser: BrowserDeps, maxChars?: number, isRemoteMode?: boolean) {
	const { tools } = createBrowserTools({
		browser,
		...(maxChars !== undefined ? { maxChars } : {}),
		...(isRemoteMode !== undefined ? { isRemoteMode } : {}),
	});
	const found = tools.find((candidate) => candidate.name === "browse_url");
	if (!found) {
		throw new Error("browse_url tool missing");
	}
	return found;
}

describe("isPrivateOrReservedIp", () => {
	it("returns true for loopback addresses (127.x.x.x)", () => {
		expect(isPrivateOrReservedIp("127.0.0.1")).toBe(true);
		expect(isPrivateOrReservedIp("127.255.255.255")).toBe(true);
	});

	it("returns true for RFC1918 private ranges", () => {
		expect(isPrivateOrReservedIp("10.0.0.0")).toBe(true);
		expect(isPrivateOrReservedIp("10.1.2.3")).toBe(true);
		expect(isPrivateOrReservedIp("10.255.255.255")).toBe(true);
		expect(isPrivateOrReservedIp("172.16.0.1")).toBe(true);
		expect(isPrivateOrReservedIp("172.31.255.255")).toBe(true);
		expect(isPrivateOrReservedIp("192.168.0.1")).toBe(true);
		expect(isPrivateOrReservedIp("192.168.100.200")).toBe(true);
	});

	it("returns true for link-local (169.254/16), including cloud metadata endpoint", () => {
		expect(isPrivateOrReservedIp("169.254.0.1")).toBe(true);
		expect(isPrivateOrReservedIp("169.254.169.254")).toBe(true);
		expect(isPrivateOrReservedIp("169.254.255.255")).toBe(true);
	});

	it("returns true for CGNAT (100.64/10)", () => {
		expect(isPrivateOrReservedIp("100.64.0.1")).toBe(true);
		expect(isPrivateOrReservedIp("100.127.255.255")).toBe(true);
	});

	it("returns true for IPv6 loopback (::1)", () => {
		expect(isPrivateOrReservedIp("::1")).toBe(true);
	});

	it("returns true for unique-local IPv6 (fc00::/7)", () => {
		expect(isPrivateOrReservedIp("fc00::1")).toBe(true);
		expect(isPrivateOrReservedIp("fd12:3456:789a::1")).toBe(true);
	});

	it("returns true for link-local IPv6 (fe80::/10)", () => {
		expect(isPrivateOrReservedIp("fe80::1")).toBe(true);
	});

	it("returns true for IPv4-embedding IPv6 transition ranges reaching internal IPv4 (SSRF fail-open regression)", () => {
		// Each of these carries an IPv4 in its low bits; before the fix ipaddr's range name (rfc6052/6to4/teredo)
		// was NOT in the blocklist, so the guard classified them as public → SSRF to loopback/LAN/cloud-metadata.
		expect(isPrivateOrReservedIp("64:ff9b::7f00:1")).toBe(true); // NAT64 → 127.0.0.1
		expect(isPrivateOrReservedIp("64:ff9b::a9fe:a9fe")).toBe(true); // NAT64 → 169.254.169.254 (metadata)
		expect(isPrivateOrReservedIp("2002:7f00:1::")).toBe(true); // 6to4 → 127.0.0.1
		expect(isPrivateOrReservedIp("2001::1")).toBe(true); // Teredo
	});

	it("returns false for public IPv4 addresses", () => {
		expect(isPrivateOrReservedIp("8.8.8.8")).toBe(false);
		expect(isPrivateOrReservedIp("1.1.1.1")).toBe(false);
		expect(isPrivateOrReservedIp("93.184.216.34")).toBe(false);
	});

	it("returns false for addresses just outside the private ranges (edge octets)", () => {
		// 172.15.x is NOT in 172.16/12
		expect(isPrivateOrReservedIp("172.15.255.255")).toBe(false);
		// 172.32.x is NOT in 172.16/12
		expect(isPrivateOrReservedIp("172.32.0.0")).toBe(false);
	});

	it("returns false for valid public IPv6", () => {
		// 2606:4700::1 is Cloudflare's public range — ipaddr range() = "unicast" = not blocked.
		expect(isPrivateOrReservedIp("2606:4700::1")).toBe(false);
		expect(isPrivateOrReservedIp("2a00:1450::1")).toBe(false); // Google public IPv6
	});

	it("returns false for non-IP strings (not a valid IP)", () => {
		expect(isPrivateOrReservedIp("not-an-ip")).toBe(false);
		expect(isPrivateOrReservedIp("example.com")).toBe(false);
	});
});

describe("createBrowserTools — browse_url", () => {
	it("is an egress_read action (§5.L decision-6: egress-gated read, not a host command / taint sink)", () => {
		const { tools } = createBrowserTools({ browser: fakeBrowser({ url: "https://x.com", title: "", text: "" }) });
		expect(tools[0]?.actionKind).toBe("egress_read");
	});

	it("§5.L: carries a web taint label (its output is untrusted web content)", () => {
		const { tools } = createBrowserTools({ browser: fakeBrowser({ url: "https://x.com", title: "", text: "" }) });
		expect(tools[0]?.taint).toEqual(["web"]);
	});

	it("§5.L: adds secret_like taint when the fetched page content looks credential-shaped", async () => {
		const browser = fakeBrowser({
			url: "https://example.com",
			title: "Leak",
			text: "token = 'ghp_0123456789abcdefghijABCDEFGHIJ'",
		});
		const tool = getBrowseTool(browser);
		const out = await tool.run({ url: "https://example.com" });
		expect(tool.taintFromResult?.(out, { url: "https://example.com" })).toEqual(["web", "secret_like"]);
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

	// ─── §5.Y #5 SSRF protection — remote mode ───────────────────────────────────────────────────────

	describe("remote mode — SSRF protection", () => {
		it("refuses a literal loopback IP URL without calling fetchPage", async () => {
			const browser = fakeBrowser({ url: "http://127.0.0.1/", title: "", text: "" });
			const out = await getBrowseTool(browser, undefined, true).run({ url: "http://127.0.0.1/" });
			expect(out).toContain("not allowed in remote mode");
			expect(browser.fetchPage).not.toHaveBeenCalled();
		});

		it("refuses a literal cloud-metadata IP URL (169.254.169.254) without calling fetchPage", async () => {
			const browser = fakeBrowser({ url: "http://169.254.169.254/latest/meta-data/", title: "", text: "" });
			const out = await getBrowseTool(browser, undefined, true).run({
				url: "http://169.254.169.254/latest/meta-data/",
			});
			expect(out).toContain("not allowed in remote mode");
			expect(browser.fetchPage).not.toHaveBeenCalled();
		});

		it("refuses a literal RFC1918 IP URL without calling fetchPage", async () => {
			const browser = fakeBrowser({ url: "http://192.168.1.1/", title: "", text: "" });
			const out = await getBrowseTool(browser, undefined, true).run({ url: "http://192.168.1.1/" });
			expect(out).toContain("not allowed in remote mode");
			expect(browser.fetchPage).not.toHaveBeenCalled();
		});

		it("refuses a literal 10.x private IP URL without calling fetchPage", async () => {
			const browser = fakeBrowser({ url: "http://10.0.0.1/admin", title: "", text: "" });
			const out = await getBrowseTool(browser, undefined, true).run({ url: "http://10.0.0.1/admin" });
			expect(out).toContain("not allowed in remote mode");
			expect(browser.fetchPage).not.toHaveBeenCalled();
		});

		it("refuses a literal 172.16-31.x private IP URL without calling fetchPage", async () => {
			const browser = fakeBrowser({ url: "http://172.16.0.1/", title: "", text: "" });
			const out = await getBrowseTool(browser, undefined, true).run({ url: "http://172.16.0.1/" });
			expect(out).toContain("not allowed in remote mode");
			expect(browser.fetchPage).not.toHaveBeenCalled();
		});

		it("refuses a literal IPv6 loopback URL without calling fetchPage", async () => {
			const browser = fakeBrowser({ url: "http://[::1]/", title: "", text: "" });
			const out = await getBrowseTool(browser, undefined, true).run({ url: "http://[::1]/" });
			expect(out).toContain("not allowed in remote mode");
			expect(browser.fetchPage).not.toHaveBeenCalled();
		});

		it("allows a public hostname in remote mode (fetch proceeds normally)", async () => {
			// Uses a hostname that resolves to a real public IP — mock the browser so no real navigation happens.
			// We test with example.com which always resolves to a public IP.
			const browser = fakeBrowser({ url: "https://example.com", title: "Example", text: "content" });
			// We can't easily mock DNS in a unit test, but we CAN verify that a literal public IP is allowed.
			// 93.184.216.34 is example.com's real IP — public, not private.
			const out = await getBrowseTool(browser, undefined, true).run({ url: "http://93.184.216.34/" });
			// Should NOT contain the refusal message.
			expect(out).not.toContain("not allowed in remote mode");
			expect(browser.fetchPage).toHaveBeenCalledWith("http://93.184.216.34/");
		});

		it("re-checks final URL after redirect — catches redirect-to-internal in remote mode", async () => {
			// Simulates a redirect: initial URL is public-ish (literal public IP), but fetchPage returns
			// a final URL that redirected to an internal host.
			const redirectBrowser: BrowserDeps = {
				fetchPage: vi.fn(async () => ({
					url: "http://169.254.169.254/latest/meta-data/",
					title: "Metadata",
					text: "ami-id: ami-12345",
				})),
			};
			// Use a literal public IP so the pre-navigation check passes, but the redirect lands on the metadata endpoint.
			const out = await getBrowseTool(redirectBrowser, undefined, true).run({ url: "http://93.184.216.34/" });
			expect(out).toContain("not allowed in remote mode");
		});

		it("allows private IPs in local mode (isRemoteMode=false)", async () => {
			const browser = fakeBrowser({ url: "http://127.0.0.1:3000/", title: "Dev", text: "welcome" });
			const out = await getBrowseTool(browser, undefined, false).run({ url: "http://127.0.0.1:3000/" });
			expect(out).not.toContain("not allowed in remote mode");
			expect(out).toContain("Title: Dev");
			expect(browser.fetchPage).toHaveBeenCalledWith("http://127.0.0.1:3000/");
		});

		it("allows private IPs when isRemoteMode is omitted (defaults to local mode)", async () => {
			const browser = fakeBrowser({ url: "http://192.168.1.1/", title: "Router", text: "admin panel" });
			const out = await getBrowseTool(browser).run({ url: "http://192.168.1.1/" });
			expect(out).not.toContain("not allowed in remote mode");
			expect(browser.fetchPage).toHaveBeenCalledWith("http://192.168.1.1/");
		});
	});
});

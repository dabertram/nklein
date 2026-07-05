import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { buildSsrfGuardedPageFetcher } from "../../../src/chat/chat-browser-tool";

// LIVE SSRF-floor validation (David's rule: validate integration with a live path, not just mocks). The sibling
// unit test (chat-browser-guarded-fetcher.test.ts) uses only LITERAL IPs — it exercises the synchronous
// `ipaddr.isValid` branch of checkHostForSsrf and NEVER the real `dnsLookup` branch (the "resolve host → ALL IPs,
// reject if ANY is private" fix). This test closes that gap the way the rule demands: it stands up a GENUINELY
// REACHABLE internal HTTP server on loopback (the exact target an SSRF pivot would hit — a live secret, not a string
// match), then drives the guard through the REAL node DNS resolver via the `localhost` HOSTNAME. Everything is
// loopback — no external egress, so it is safe + deterministic in CI while still being a real end-to-end path.
describe("buildSsrfGuardedPageFetcher — LIVE proof-of-block against a real internal server", () => {
	let server: Server;
	let port = 0;
	const SECRET = "TOP-SECRET-INTERNAL-PAYLOAD";

	// The injected fetchPage is a REAL HTTP GET (node's global fetch). If the guard ever let a blocked URL through,
	// this would actually retrieve the secret from the live loopback server — so "never called" is a real exfil proof.
	const realFetchPage = vi.fn(async (url: string) => {
		const res = await fetch(url);
		const text = await res.text();
		return { url, title: "", text };
	});

	beforeAll(async () => {
		server = createServer((_req, res) => {
			res.writeHead(200, { "content-type": "text/plain" });
			res.end(SECRET);
		});
		await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
		port = (server.address() as AddressInfo).port;
	});

	afterAll(async () => {
		await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
	});

	it("positive control: the internal server is genuinely reachable + serving the secret", async () => {
		// Proves the block below is a real refusal, not a false 'unreachable' — the secret really is fetchable here.
		const res = await fetch(`http://127.0.0.1:${port}/`);
		await expect(res.text()).resolves.toBe(SECRET);
	});

	it("blocks a loopback LITERAL-IP URL and never retrieves the live secret", async () => {
		realFetchPage.mockClear();
		const guarded = buildSsrfGuardedPageFetcher({ fetchPage: realFetchPage });
		await expect(guarded(`http://127.0.0.1:${port}/`)).rejects.toThrow(/internal\/private/i);
		expect(realFetchPage).not.toHaveBeenCalled();
	});

	it("blocks via the REAL DNS resolver: `localhost` resolves to loopback and is refused", async () => {
		// This is the branch the literal-IP unit test cannot reach: checkHostForSsrf calls the real node dnsLookup,
		// which resolves `localhost` (via /etc/hosts) to 127.0.0.1 (and/or ::1) — both private/reserved — so the
		// guard must refuse BEFORE any fetch. Validates the "resolve → ALL IPs → reject if ANY private" logic live.
		realFetchPage.mockClear();
		const guarded = buildSsrfGuardedPageFetcher({ fetchPage: realFetchPage });
		await expect(guarded(`http://localhost:${port}/`)).rejects.toThrow(/internal\/private/i);
		expect(realFetchPage).not.toHaveBeenCalled();
	});
});

import { describe, expect, it, vi } from "vitest";

// Isolate the DNS mock to this file so the rest of the browser-tool suite keeps real behavior.
vi.mock("node:dns/promises", () => ({ lookup: vi.fn() }));

import { lookup as dnsLookup } from "node:dns/promises";
import { checkHostForSsrf } from "../../../src/chat/chat-browser-tool";

describe("checkHostForSsrf — DNS resolution guard checks ALL addresses", () => {
	it("blocks a host that resolves to a MIX of public and private IPs (not just the first)", async () => {
		// The old guard read only result.address (the first record), so a public-first record let the private one
		// through. It must fail-closed on the whole record set.
		vi.mocked(dnsLookup).mockResolvedValue([
			{ address: "93.184.216.34", family: 4 },
			{ address: "10.0.0.5", family: 4 },
		] as never);
		expect(await checkHostForSsrf("http://mixed.example.test/")).toMatch(/internal\/private/u);
	});

	it("allows a host that resolves only to public IPs", async () => {
		vi.mocked(dnsLookup).mockResolvedValue([
			{ address: "93.184.216.34", family: 4 },
			{ address: "1.1.1.1", family: 4 },
		] as never);
		expect(await checkHostForSsrf("http://public.example.test/")).toBeNull();
	});

	it("does not false-positive when DNS resolution fails (host may just be unreachable)", async () => {
		vi.mocked(dnsLookup).mockRejectedValue(new Error("ENOTFOUND"));
		expect(await checkHostForSsrf("http://unreachable.example.test/")).toBeNull();
	});
});

import { describe, expect, it } from "vitest";
import { assertLocalModelBaseUrl } from "../../../src/core/local-model-base-url";

/**
 * Coverage for a module the P20.3b ablation sweep found had NO exercising test (2026-08-08) — and of the seven,
 * this is the one that most needed one: it enforces the LOCAL-ONLY prime directive. Every case it waves through
 * is a benchmark lane talking to a public endpoint.
 *
 * A guard is only as good as the inputs nobody thought to try, so these tests are weighted toward the boundary
 * (`172.16.0.0/12` is a 16-band range, and both edges are one character from a public address) and toward the
 * REJECT direction, which is where the cost lives.
 *
 * ── THE ERROR MATCHERS ARE ANCHORED ON THE GUARD'S OWN WORDS, ON PURPOSE ──
 * A first version matched `/loopback|private|local/i`, and the ablation run reported that 3 of 11 tests "passed
 * with AND without" the module: the stub's own failure text (`ABLATED_STUB via assertLocalModelBaseUrl`)
 * contains "Local", so a loose alternation matched a throw that proved nothing. A `toThrow` assertion is
 * satisfied by ANY throw — including the one a broken implementation makes — so the matcher has to name text
 * only the real guard produces.
 */
describe("assertLocalModelBaseUrl — accepts", () => {
	it("loopback, by name and by address", () => {
		expect(assertLocalModelBaseUrl("http://localhost:1234/v1")).toBe("http://localhost:1234/v1");
		expect(assertLocalModelBaseUrl("http://127.0.0.1:1234/v1")).toBe("http://127.0.0.1:1234/v1");
		expect(assertLocalModelBaseUrl("http://[::1]:1234/v1")).toBe("http://[::1]:1234/v1");
	});

	it("every private IPv4 band the RFC defines", () => {
		for (const host of ["10.0.0.5", "172.16.0.1", "172.31.255.254", "192.168.1.50", "169.254.10.1"]) {
			expect(() => assertLocalModelBaseUrl(`http://${host}:8080`)).not.toThrow();
		}
	});

	it("local hostnames — .local and a bare, dotless name", () => {
		expect(() => assertLocalModelBaseUrl("http://m5max.local:1234")).not.toThrow();
		expect(() => assertLocalModelBaseUrl("http://qwable:1234")).not.toThrow();
	});

	it("link-local IPv6", () => {
		expect(() => assertLocalModelBaseUrl("http://[fe80::1]:1234")).not.toThrow();
	});

	it("normalises away a trailing slash so callers can concatenate safely", () => {
		expect(assertLocalModelBaseUrl("http://localhost:1234/v1/")).toBe("http://localhost:1234/v1");
		expect(assertLocalModelBaseUrl("http://localhost:1234/")).toBe("http://localhost:1234");
	});
});

describe("assertLocalModelBaseUrl — rejects", () => {
	it("public IPv4 addresses", () => {
		for (const host of ["8.8.8.8", "1.1.1.1", "203.0.113.5"]) {
			expect(() => assertLocalModelBaseUrl(`http://${host}`)).toThrow(/must address loopback/i);
		}
	});

	it("the 172 band's OUTSIDE edges — the classic off-by-one", () => {
		// 172.16–172.31 is private; 172.15 and 172.32 are ordinary public space and one character away. A range
		// check written as `>= 16 && <= 32` or `> 15 && < 31` passes every mid-range fixture and fails exactly here.
		expect(() => assertLocalModelBaseUrl("http://172.15.0.1")).toThrow(/must address loopback/i);
		expect(() => assertLocalModelBaseUrl("http://172.32.0.1")).toThrow(/must address loopback/i);
	});

	it("public hostnames — the case this guard exists for", () => {
		for (const host of ["api.openai.com", "api.anthropic.com", "example.com"]) {
			expect(() => assertLocalModelBaseUrl(`https://${host}/v1`)).toThrow(/must address loopback/i);
		}
	});

	it("credentials, a query, or a fragment — anywhere they appear", () => {
		// Each is refused separately, so a check that tests only one of the four still fails here.
		expect(() => assertLocalModelBaseUrl("http://user@localhost:1234")).toThrow(/cannot contain credentials/i);
		expect(() => assertLocalModelBaseUrl("http://user:pass@localhost:1234")).toThrow(/cannot contain credentials/i);
		expect(() => assertLocalModelBaseUrl("http://localhost:1234/v1?key=secret")).toThrow(
			/cannot contain credentials/i,
		);
		expect(() => assertLocalModelBaseUrl("http://localhost:1234/v1#frag")).toThrow(/cannot contain credentials/i);
	});

	it("non-http protocols, including the ones that look harmless", () => {
		for (const url of ["file:///etc/passwd", "ftp://localhost/x", "ws://localhost:1234", "data:text/plain,x"]) {
			expect(() => assertLocalModelBaseUrl(url)).toThrow(/must use http|must be a valid URL/i);
		}
	});

	it("input that is not a URL at all", () => {
		for (const value of ["", "localhost:1234", "not a url", "://missing-scheme"]) {
			expect(() => assertLocalModelBaseUrl(value)).toThrow(/must be a valid URL|must use http/i);
		}
	});
});

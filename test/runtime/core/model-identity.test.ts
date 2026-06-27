import { describe, expect, it } from "vitest";
import { normalizeEndpoint, normalizeModelId, normalizeProviderId } from "../../../src/core/model-identity";

describe("normalizeProviderId", () => {
	it("lowercases and trims; blank collapses to the unknown sentinel", () => {
		expect(normalizeProviderId("LMStudio")).toBe("lmstudio");
		expect(normalizeProviderId("  OpenAI  ")).toBe("openai");
		expect(normalizeProviderId("")).toBe("unknown");
		expect(normalizeProviderId("   ")).toBe("unknown");
	});
});

describe("normalizeModelId", () => {
	it("trims but preserves case (vendor slugs are case-sensitive); blank → unknown", () => {
		expect(normalizeModelId("  qwen/qwen3-8b  ")).toBe("qwen/qwen3-8b");
		expect(normalizeModelId("Qwen/Qwen3-8B")).toBe("Qwen/Qwen3-8B"); // case NOT folded
		expect(normalizeModelId("")).toBe("unknown");
		expect(normalizeModelId("   ")).toBe("unknown");
	});
});

describe("normalizeEndpoint", () => {
	it("returns null for absent/blank/non-string input", () => {
		expect(normalizeEndpoint(null)).toBeNull();
		expect(normalizeEndpoint(undefined)).toBeNull();
		expect(normalizeEndpoint("")).toBeNull();
		expect(normalizeEndpoint("   ")).toBeNull();
	});

	it("canonicalizes every loopback spelling to localhost and drops a trailing slash", () => {
		expect(normalizeEndpoint("http://127.0.0.1:1234/v1")).toBe("http://localhost:1234/v1");
		expect(normalizeEndpoint("http://0.0.0.0:1234/v1")).toBe("http://localhost:1234/v1");
		expect(normalizeEndpoint("http://[::1]:1234/v1")).toBe("http://localhost:1234/v1");
		expect(normalizeEndpoint("http://localhost:1234/v1/")).toBe("http://localhost:1234/v1");
	});

	it("maps the SAME local server addressed differently onto one key (the §5.Q registry/telemetry bug)", () => {
		expect(normalizeEndpoint("http://127.0.0.1:1234/v1")).toBe(normalizeEndpoint("http://localhost:1234/v1/"));
	});

	it("preserves a non-loopback host, the port, and the query string", () => {
		expect(normalizeEndpoint("http://example.com:8080/v1")).toBe("http://example.com:8080/v1");
		expect(normalizeEndpoint("http://localhost:1234/v1?foo=bar")).toBe("http://localhost:1234/v1?foo=bar");
	});

	it("returns a non-URL string trimmed rather than throwing", () => {
		expect(normalizeEndpoint("  not a url  ")).toBe("not a url");
	});
});

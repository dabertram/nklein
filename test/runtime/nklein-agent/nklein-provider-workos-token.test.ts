import { describe, expect, it } from "vitest";
import {
	ensureWorkosPrefix,
	stripWorkosPrefix,
	toProviderApiKey,
} from "../../../src/nklein-agent/nklein-provider-workos-token";

describe("stripWorkosPrefix", () => {
	it("removes a leading workos: prefix", () => {
		expect(stripWorkosPrefix("workos:tok_123")).toBe("tok_123");
	});

	it("matches the prefix case-insensitively", () => {
		expect(stripWorkosPrefix("WORKOS:tok_123")).toBe("tok_123");
	});

	it("leaves an unprefixed token untouched", () => {
		expect(stripWorkosPrefix("tok_123")).toBe("tok_123");
		expect(stripWorkosPrefix("")).toBe("");
	});
});

describe("ensureWorkosPrefix", () => {
	it("prepends the prefix to a bare token", () => {
		expect(ensureWorkosPrefix("tok_123")).toBe("workos:tok_123");
	});

	it("does not double-prefix an already-prefixed token (case-insensitive)", () => {
		expect(ensureWorkosPrefix("workos:tok_123")).toBe("workos:tok_123");
		expect(ensureWorkosPrefix("WORKOS:tok_123")).toBe("WORKOS:tok_123");
	});

	it("trims surrounding whitespace before prefixing", () => {
		expect(ensureWorkosPrefix("  tok_123  ")).toBe("workos:tok_123");
	});

	it("returns an empty string for an empty / whitespace-only token (never a bare prefix)", () => {
		expect(ensureWorkosPrefix("")).toBe("");
		expect(ensureWorkosPrefix("   ")).toBe("");
	});
});

describe("toProviderApiKey", () => {
	it("tags the managed nklein provider's token with the workos: prefix", () => {
		expect(toProviderApiKey("nklein", "tok_123")).toBe("workos:tok_123");
	});

	it("passes other managed providers' tokens through unchanged", () => {
		expect(toProviderApiKey("oca", "tok_123")).toBe("tok_123");
		expect(toProviderApiKey("openai-codex", "tok_123")).toBe("tok_123");
	});
});

describe("ensureWorkosPrefix / stripWorkosPrefix round-trip", () => {
	it("strip undoes ensure for a bare token", () => {
		expect(stripWorkosPrefix(ensureWorkosPrefix("tok_123"))).toBe("tok_123");
	});
});

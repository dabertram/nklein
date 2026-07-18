import { describe, expect, it } from "vitest";
import {
	normalizeOpenAiCompatBaseUrl,
	normalizeProviderBaseUrl,
	OPENAI_COMPAT_LOCAL_PROVIDER_IDS,
} from "../../../src/core/openai-compat-base-url";

describe("normalizeOpenAiCompatBaseUrl (the empty-200 root-route foot-gun)", () => {
	it("appends /v1 to a bare host", () => {
		expect(normalizeOpenAiCompatBaseUrl("http://127.0.0.1:1234")).toBe("http://127.0.0.1:1234/v1");
	});

	it("leaves an explicit versioned root untouched (idempotent)", () => {
		expect(normalizeOpenAiCompatBaseUrl("http://localhost:1234/v1")).toBe("http://localhost:1234/v1");
		expect(normalizeOpenAiCompatBaseUrl("http://localhost:1234/v2")).toBe("http://localhost:1234/v2");
		const once = normalizeOpenAiCompatBaseUrl("http://h:1/v1");
		expect(normalizeOpenAiCompatBaseUrl(once)).toBe(once);
	});

	it("strips trailing slashes and whitespace before deciding", () => {
		expect(normalizeOpenAiCompatBaseUrl("  http://h:1234///  ")).toBe("http://h:1234/v1");
		expect(normalizeOpenAiCompatBaseUrl("http://h:1234/v1/")).toBe("http://h:1234/v1");
	});

	it("returns empty input unchanged so absent-handling stays with the caller", () => {
		expect(normalizeOpenAiCompatBaseUrl("   ")).toBe("");
	});
});

describe("normalizeProviderBaseUrl (provider-family gate)", () => {
	it("normalizes the local openai-compat families only", () => {
		for (const providerId of OPENAI_COMPAT_LOCAL_PROVIDER_IDS) {
			expect(normalizeProviderBaseUrl(providerId, "http://h:1")).toBe("http://h:1/v1");
		}
		expect(normalizeProviderBaseUrl("anthropic", "http://h:1")).toBe("http://h:1");
	});
});

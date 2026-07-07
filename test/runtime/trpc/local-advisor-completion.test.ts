import { describe, expect, it } from "vitest";
import type { ResolvedNKleinLaunchConfig } from "../../../src/nklein-agent/nklein-provider-service";
import {
	joinUrlPath,
	readAdvisorTextResponse,
	resolveAdvisorOllamaBaseUrl,
	resolveAdvisorOpenAiBaseUrl,
} from "../../../src/trpc/runtime-api/local-advisor-completion";

function launchConfig(over: Partial<{ baseUrl: string | null; providerId: string }> = {}): ResolvedNKleinLaunchConfig {
	return { baseUrl: over.baseUrl ?? null, providerId: over.providerId ?? "ollama" } as ResolvedNKleinLaunchConfig;
}

describe("joinUrlPath", () => {
	it("joins with exactly one slash, trimming extras", () => {
		expect(joinUrlPath("http://x/", "/v1/chat")).toBe("http://x/v1/chat");
		expect(joinUrlPath("http://x", "v1")).toBe("http://x/v1");
		expect(joinUrlPath("http://x///", "///v1")).toBe("http://x/v1");
	});
});

describe("resolveAdvisorOpenAiBaseUrl", () => {
	it("ensures a /v1 suffix on a configured base url (idempotent, trailing slash trimmed)", () => {
		expect(resolveAdvisorOpenAiBaseUrl(launchConfig({ baseUrl: "http://h:1234" }))).toBe("http://h:1234/v1");
		expect(resolveAdvisorOpenAiBaseUrl(launchConfig({ baseUrl: "http://h:1234/v1" }))).toBe("http://h:1234/v1");
		expect(resolveAdvisorOpenAiBaseUrl(launchConfig({ baseUrl: "http://h:1234/v1/" }))).toBe("http://h:1234/v1");
	});

	it("falls back per provider when no base url is configured", () => {
		expect(resolveAdvisorOpenAiBaseUrl(launchConfig({ providerId: "lmstudio" }))).toBe("http://127.0.0.1:1234/v1");
		expect(resolveAdvisorOpenAiBaseUrl(launchConfig({ providerId: "lm-studio" }))).toBe("http://127.0.0.1:1234/v1");
		expect(resolveAdvisorOpenAiBaseUrl(launchConfig({ providerId: "ollama" }))).toBe("http://localhost:11434/v1");
	});

	it("tolerates a non-URL configured value (prepends an http scheme so the result is fetchable)", () => {
		expect(resolveAdvisorOpenAiBaseUrl(launchConfig({ baseUrl: "notaurl" }))).toBe("http://notaurl/v1");
	});

	it("prepends an http scheme to a scheme-less host:port so the result is a fetchable absolute URL", () => {
		// A scheme-less local baseUrl passes the local-only gate but URL-parses the port as an opaque path;
		// without a scheme the joined /chat/completions URL is not accepted by fetch().
		const resolved = resolveAdvisorOpenAiBaseUrl(launchConfig({ baseUrl: "192.168.1.5:1234" }));
		expect(resolved).toBe("http://192.168.1.5:1234/v1");
		expect(() => new URL(`${resolved}/chat/completions`)).not.toThrow();
		expect(resolveAdvisorOpenAiBaseUrl(launchConfig({ baseUrl: "localhost:1234" }))).toBe("http://localhost:1234/v1");
	});
});

describe("resolveAdvisorOllamaBaseUrl", () => {
	it("trims a trailing slash or defaults to localhost:11434", () => {
		expect(resolveAdvisorOllamaBaseUrl(launchConfig({ baseUrl: "http://h:11434/" }))).toBe("http://h:11434");
		expect(resolveAdvisorOllamaBaseUrl(launchConfig())).toBe("http://localhost:11434");
	});

	it("prepends an http scheme to a scheme-less host:port so the result is a fetchable absolute URL", () => {
		const resolved = resolveAdvisorOllamaBaseUrl(launchConfig({ baseUrl: "192.168.1.5:11434" }));
		expect(resolved).toBe("http://192.168.1.5:11434");
		expect(() => new URL(`${resolved}/api/chat`)).not.toThrow();
	});
});

describe("readAdvisorTextResponse", () => {
	it("reads the Ollama, /response, and OpenAI-choices response shapes", () => {
		expect(readAdvisorTextResponse({ message: { content: "ollama" } })).toBe("ollama");
		expect(readAdvisorTextResponse({ response: "generate" })).toBe("generate");
		expect(readAdvisorTextResponse({ choices: [{ message: { content: "openai" } }] })).toBe("openai");
		expect(readAdvisorTextResponse({ choices: [{ text: "legacy" }] })).toBe("legacy");
	});

	it("returns empty for unrecognized or non-object values", () => {
		expect(readAdvisorTextResponse(null)).toBe("");
		expect(readAdvisorTextResponse("a string")).toBe("");
		expect(readAdvisorTextResponse({ unrelated: 1 })).toBe("");
		expect(readAdvisorTextResponse({ choices: [] })).toBe("");
	});
});

import { describe, expect, it } from "vitest";
import {
	assertLocalProviderAllowed,
	CLOUD_ENABLED,
	CloudProviderDisabledError,
	isCloudProviderDisabledError,
	isLocalBaseUrl,
	isLocalProvider,
	LOCAL_PROVIDER_IDS,
} from "../../../src/cline-sdk/cline-local-only-policy";

describe("cline local-only policy", () => {
	it("ships with cloud disabled", () => {
		expect(CLOUD_ENABLED).toBe(false);
		expect([...LOCAL_PROVIDER_IDS].sort()).toEqual(["lm-studio", "lmstudio", "ollama"]);
	});

	it("allows local providers by id regardless of baseUrl", () => {
		for (const providerId of ["ollama", "lmstudio", "lm-studio", "LMStudio", " Ollama "]) {
			expect(isLocalProvider(providerId)).toBe(true);
			expect(() => assertLocalProviderAllowed({ providerId })).not.toThrow();
		}
	});

	it("denies every cloud provider id (default-deny)", () => {
		const cloudIds = [
			"cline",
			"oca",
			"openai-codex",
			"anthropic",
			"openai",
			"openai-native",
			"gemini",
			"vertex",
			"bedrock",
			"openrouter",
			"deepseek",
			"mistral",
			"xai",
			"groq",
			"together",
			"fireworks",
			"unconfigured",
			"some-future-cloud-provider",
		];
		for (const providerId of cloudIds) {
			expect(isLocalProvider(providerId)).toBe(false);
			expect(() => assertLocalProviderAllowed({ providerId })).toThrow(CloudProviderDisabledError);
		}
	});

	it("treats managed Cline OAuth providers as cloud even with a local baseUrl", () => {
		expect(isLocalProvider("cline", "http://localhost:1234/v1")).toBe(false);
		expect(() => assertLocalProviderAllowed({ providerId: "cline", baseUrl: "http://127.0.0.1:1234" })).toThrow(
			CloudProviderDisabledError,
		);
	});

	it("allows custom/openai-compatible providers only when the endpoint is local", () => {
		expect(isLocalProvider("openai-compatible", "http://localhost:1234/v1")).toBe(true);
		expect(isLocalProvider("openai-compatible", "http://127.0.0.1:8080")).toBe(true);
		expect(isLocalProvider("openai-compatible", "http://192.168.1.50:1234/v1")).toBe(true);
		expect(isLocalProvider("my-llamacpp", "localhost:8000")).toBe(true);
		expect(isLocalProvider("openai-compatible", "https://api.openai.com/v1")).toBe(false);
		expect(isLocalProvider("openai-compatible", null)).toBe(false);
	});

	it("recognizes loopback / private / link-local hosts", () => {
		for (const url of [
			"http://localhost:1234",
			"http://127.0.0.1:1234/v1",
			"http://0.0.0.0:11434",
			"http://10.0.0.5:1234",
			"http://172.16.4.2:8080",
			"http://192.168.0.10:1234",
			"http://169.254.1.1:1234",
			"http://100.100.1.1:1234",
			"http://my-box.local:1234",
		]) {
			expect(isLocalBaseUrl(url)).toBe(true);
		}
		for (const url of ["https://api.openai.com", "http://8.8.8.8:1234", "http://172.32.0.1", "", null]) {
			expect(isLocalBaseUrl(url)).toBe(false);
		}
	});

	it("exposes a typed error guard with the offending provider id", () => {
		try {
			assertLocalProviderAllowed({ providerId: "openrouter" });
			expect.unreachable("should have thrown");
		} catch (error) {
			expect(isCloudProviderDisabledError(error)).toBe(true);
			expect((error as CloudProviderDisabledError).providerId).toBe("openrouter");
			expect((error as CloudProviderDisabledError).message).toContain("local-only mode");
		}
	});
});

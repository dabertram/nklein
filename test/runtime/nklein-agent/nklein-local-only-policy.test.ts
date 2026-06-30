import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import {
	assertLocalProviderAllowed,
	CLOUD_ENABLED,
	CloudProviderDisabledError,
	isCloudProviderDisabledError,
	isLocalBaseUrl,
	isLocalProvider,
	LOCAL_PROVIDER_IDS,
} from "../../../src/nklein-agent/nklein-local-only-policy";

const CLOUD_PROVIDER_SENTINEL_PATTERN = /\b(openrouter|anthropic|openai-codex|openai-native|oca|claude-sonnet)\b/;

const CLOUD_LITERAL_ALLOWLIST = new Map<string, string>([
	[
		"src/nklein-agent/nklein-local-only-policy.ts",
		"The policy owns the managed-cloud denylist and local-only error wording.",
	],
	[
		"src/nklein-agent/nklein-provider-service.ts",
		"The provider service blocks managed NKlein OAuth/cloud settings before persistence or dispatch.",
	],
	[
		"src/nklein-agent/nklein-provider-id-classification.ts",
		"Classifies provider ids (managed-OAuth vs live-only) and maps managed ids to display names; the provider-id boundary helpers extracted from nklein-provider-service.",
	],
	[
		"src/nklein-agent/sdk-provider-boundary.ts",
		"The SDK boundary maps managed NKlein OAuth provider settings into SDK-owned shapes.",
	],
	[
		"src/core/api-contract.ts",
		"The runtime API contract exposes the managed NKlein OAuth enum for saved settings compatibility.",
	],
	[
		"src/core/nklein-provider-api-contract.ts",
		"The NKlein account/provider/model-registry contract module (split from api-contract.ts, §5.X #2) exposes the managed NKlein OAuth enum for saved-settings compatibility.",
	],
	[
		"src/nklein-agent/nklein-advisor.ts",
		"Advisor source URLs are user-triggered research references, not dispatch defaults.",
	],
	[
		"src/nklein-agent/nklein-web-research-tool.ts",
		"Web-research allowed domains are user-triggered research references, not dispatch defaults.",
	],
	["src/core/agent-catalog.ts", "Claude Code install docs are for the separate Claude CLI agent."],
]);

async function collectTypeScriptSourceFiles(directory: string): Promise<string[]> {
	const entries = await readdir(directory, { withFileTypes: true });
	const files: string[] = [];
	for (const entry of entries) {
		const path = join(directory, entry.name);
		if (entry.isDirectory()) {
			files.push(...(await collectTypeScriptSourceFiles(path)));
			continue;
		}
		if (entry.isFile() && entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
			files.push(path);
		}
	}
	return files;
}

describe("nklein local-only policy", () => {
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
			"nklein",
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

	it("treats managed NKlein OAuth providers as cloud even with a local baseUrl", () => {
		expect(isLocalProvider("nklein", "http://localhost:1234/v1")).toBe(false);
		expect(() => assertLocalProviderAllowed({ providerId: "nklein", baseUrl: "http://127.0.0.1:1234" })).toThrow(
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

	it("keeps production cloud-provider literals confined to documented boundary files", async () => {
		const sourceFiles = await collectTypeScriptSourceFiles("src");
		const violations: string[] = [];
		for (const file of sourceFiles) {
			const normalizedPath = relative(process.cwd(), file);
			const contents = await readFile(file, "utf8");
			if (!CLOUD_PROVIDER_SENTINEL_PATTERN.test(contents)) {
				continue;
			}
			if (CLOUD_LITERAL_ALLOWLIST.has(normalizedPath)) {
				continue;
			}
			violations.push(normalizedPath);
		}

		expect(violations, `Unexpected NKlein cloud-provider literals outside local-only boundaries`).toEqual([]);
	});
});

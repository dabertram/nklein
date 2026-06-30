import { describe, expect, it } from "vitest";

import {
	formatManagedProviderDisplayName,
	isLiveOnlyProviderId,
	isManagedOauthProviderId,
} from "../../../src/nklein-agent/nklein-provider-id-classification";

describe("isManagedOauthProviderId", () => {
	it("is true for exactly the managed-OAuth providers", () => {
		for (const id of ["nklein", "oca", "openai-codex"]) {
			expect(isManagedOauthProviderId(id)).toBe(true);
		}
	});

	it("is false for API-key / local providers and junk", () => {
		for (const id of ["lmstudio", "ollama", "openai", "anthropic", "OCA", " nklein ", ""]) {
			expect(isManagedOauthProviderId(id)).toBe(false);
		}
	});
});

describe("isLiveOnlyProviderId", () => {
	it("is true for lmstudio, case- and whitespace-insensitively", () => {
		expect(isLiveOnlyProviderId("lmstudio")).toBe(true);
		expect(isLiveOnlyProviderId("  LMStudio ")).toBe(true);
	});

	it("is false for any other provider", () => {
		for (const id of ["ollama", "nklein", "openai", ""]) {
			expect(isLiveOnlyProviderId(id)).toBe(false);
		}
	});
});

describe("formatManagedProviderDisplayName", () => {
	it("maps each managed provider id to its human-facing name", () => {
		expect(formatManagedProviderDisplayName("nklein")).toBe("!Klein");
		expect(formatManagedProviderDisplayName("oca")).toBe("Oracle Code Assist");
		expect(formatManagedProviderDisplayName("openai-codex")).toBe("OpenAI Codex");
	});
});

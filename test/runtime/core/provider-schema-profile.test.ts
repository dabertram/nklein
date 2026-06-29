import { describe, expect, it } from "vitest";

import {
	PROVIDER_SCHEMA_PROFILES,
	type SchemaProvider,
	selectProviderSchemaProfile,
} from "../../../src/core/provider-schema-profile";

describe("provider schema profiles", () => {
	it("lmstudio resolves to its profile", () => {
		const profile = selectProviderSchemaProfile("lmstudio");
		expect(profile.provider).toBe("lmstudio");
		expect(profile.supportsNestedObjects).toBe(true);
		expect(profile.supportsEnum).toBe(true);
		expect(profile.supportsAdditionalProperties).toBe(false);
		expect(profile.maxDepth).toBe(4);
		expect(profile.needsJsonRepairFallback).toBe(true);
	});

	it("llamacpp resolves to its profile", () => {
		const profile = selectProviderSchemaProfile("llamacpp");
		expect(profile.provider).toBe("llamacpp");
		expect(profile.supportsNestedObjects).toBe(true);
		expect(profile.supportsEnum).toBe(true);
		expect(profile.supportsAdditionalProperties).toBe(false);
		expect(profile.maxDepth).toBe(3);
		expect(profile.needsJsonRepairFallback).toBe(true);
	});

	it("openai-compatible resolves to its profile", () => {
		const profile = selectProviderSchemaProfile("openai-compatible");
		expect(profile.provider).toBe("openai-compatible");
		expect(profile.supportsNestedObjects).toBe(true);
		expect(profile.supportsEnum).toBe(true);
		expect(profile.supportsAdditionalProperties).toBe(true);
		expect(profile.maxDepth).toBe(5);
		expect(profile.needsJsonRepairFallback).toBe(false);
	});

	it("openai-compatible needs no JSON repair fallback", () => {
		const profile = selectProviderSchemaProfile("openai-compatible");
		expect(profile.needsJsonRepairFallback).toBe(false);
	});

	it("llamacpp and lmstudio need JSON repair fallback", () => {
		const llamacppProfile = selectProviderSchemaProfile("llamacpp");
		const lmstudioProfile = selectProviderSchemaProfile("lmstudio");
		expect(llamacppProfile.needsJsonRepairFallback).toBe(true);
		expect(lmstudioProfile.needsJsonRepairFallback).toBe(true);
	});

	it("maxDepth ordering is sane: openai >= lmstudio >= llamacpp", () => {
		const openaiProfile = selectProviderSchemaProfile("openai-compatible");
		const lmstudioProfile = selectProviderSchemaProfile("lmstudio");
		const llamacppProfile = selectProviderSchemaProfile("llamacpp");
		expect(openaiProfile.maxDepth).toBeGreaterThanOrEqual(lmstudioProfile.maxDepth);
		expect(lmstudioProfile.maxDepth).toBeGreaterThanOrEqual(llamacppProfile.maxDepth);
	});

	it("table contains all three providers", () => {
		const providers: SchemaProvider[] = ["lmstudio", "llamacpp", "openai-compatible"];
		for (const provider of providers) {
			expect(PROVIDER_SCHEMA_PROFILES[provider]).toBeDefined();
			expect(PROVIDER_SCHEMA_PROFILES[provider].provider).toBe(provider);
		}
	});
});

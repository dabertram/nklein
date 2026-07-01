import { describe, expect, it } from "vitest";
import type { RuntimeConfigState } from "../../../src/config/runtime-config";
import type { RuntimeNKleinProviderSettings } from "../../../src/core/api-contract";
import {
	buildNKleinModelRegistryKey,
	createNKleinModelRegistryEntry,
} from "../../../src/nklein-agent/nklein-model-registry";
import type { ResolvedNKleinLaunchConfig } from "../../../src/nklein-agent/nklein-provider-service";
import { addConfiguredLocalModelRegistryEntries } from "../../../src/trpc/runtime-api/model-registry";

const NOW = 1000;
const launch = (o: Record<string, unknown>) => o as unknown as ResolvedNKleinLaunchConfig;
const settings = (o: Record<string, unknown>) => o as unknown as RuntimeNKleinProviderSettings;
const config = (roles: Record<string, { providerId?: string; modelId?: string }>) =>
	({ effectiveModelRoles: roles }) as unknown as RuntimeConfigState;

describe("addConfiguredLocalModelRegistryEntries", () => {
	it("adds a local launchConfig model as a registry entry", () => {
		const models = addConfiguredLocalModelRegistryEntries({
			models: {},
			runtimeConfig: null,
			launchConfig: launch({ providerId: "lmstudio", modelId: "m1", baseUrl: "http://localhost:1234" }),
			providerSettings: null,
			now: NOW,
		});
		const key = buildNKleinModelRegistryKey({
			providerId: "lmstudio",
			modelId: "m1",
			endpoint: "http://localhost:1234",
		});
		expect(models[key]?.modelId).toBe("m1");
	});

	it("skips a non-local provider (cloud endpoint)", () => {
		const models = addConfiguredLocalModelRegistryEntries({
			models: {},
			runtimeConfig: null,
			launchConfig: launch({ providerId: "openai", modelId: "gpt", baseUrl: "https://api.openai.com" }),
			providerSettings: null,
			now: NOW,
		});
		expect(Object.keys(models)).toHaveLength(0);
	});

	it("adds a local providerSettings model", () => {
		const models = addConfiguredLocalModelRegistryEntries({
			models: {},
			runtimeConfig: null,
			launchConfig: null,
			providerSettings: settings({ providerId: "ollama", modelId: "llama", baseUrl: null }),
			now: NOW,
		});
		const key = buildNKleinModelRegistryKey({ providerId: "ollama", modelId: "llama", endpoint: null });
		expect(models[key]?.modelId).toBe("llama");
	});

	it("adds local models from effectiveModelRoles, trimming and skipping incomplete roles", () => {
		const models = addConfiguredLocalModelRegistryEntries({
			models: {},
			runtimeConfig: config({
				good: { providerId: " lmstudio ", modelId: " m2 " },
				missingModel: { providerId: "lmstudio", modelId: "" },
				missingProvider: { providerId: "", modelId: "m3" },
			}),
			launchConfig: null,
			providerSettings: null,
			now: NOW,
		});
		const key = buildNKleinModelRegistryKey({ providerId: "lmstudio", modelId: "m2", endpoint: null });
		expect(Object.keys(models)).toEqual([key]); // only the trimmed "good" role
	});

	it("does not overwrite an existing entry for the same key (dedupe)", () => {
		const key = buildNKleinModelRegistryKey({ providerId: "lmstudio", modelId: "m1", endpoint: null });
		const existing = createNKleinModelRegistryEntry({ providerId: "lmstudio", modelId: "m1", endpoint: null }, 5);
		const models = addConfiguredLocalModelRegistryEntries({
			models: { [key]: existing },
			runtimeConfig: config({ r: { providerId: "lmstudio", modelId: "m1" } }),
			launchConfig: null,
			providerSettings: null,
			now: NOW,
		});
		expect(models[key]).toBe(existing); // same object reference — not replaced
	});

	it("returns the input models unchanged when there are no candidates", () => {
		expect(
			addConfiguredLocalModelRegistryEntries({
				models: {},
				runtimeConfig: null,
				launchConfig: null,
				providerSettings: null,
				now: NOW,
			}),
		).toEqual({});
	});
});

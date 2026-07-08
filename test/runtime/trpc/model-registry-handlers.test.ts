import { describe, expect, it, vi } from "vitest";
import type { RuntimeConfigState } from "../../../src/config/runtime-config";
import type { RuntimeNKleinProviderSettings } from "../../../src/core/api-contract";
import type { ModelCapabilityEntry } from "../../../src/core/model-capability-catalog";
import {
	buildNKleinModelRegistryKey,
	createNKleinModelRegistryEntry,
} from "../../../src/nklein-agent/nklein-model-registry";
import type { ResolvedNKleinLaunchConfig } from "../../../src/nklein-agent/nklein-provider-service";
import {
	addConfiguredLocalModelRegistryEntries,
	buildRuntimeModelFleetSuggestions,
} from "../../../src/trpc/runtime-api/model-registry";

const NOW = 1000;
const launch = (o: Record<string, unknown>) => o as unknown as ResolvedNKleinLaunchConfig;
const settings = (o: Record<string, unknown>) => o as unknown as RuntimeNKleinProviderSettings;
const config = (roles: Record<string, { providerId?: string; modelId?: string }>) =>
	({ effectiveModelRoles: roles }) as unknown as RuntimeConfigState;
const catalogEntry = (family: string): ModelCapabilityEntry => ({
	family,
	match: new RegExp(family),
	toolUse: "TOOL_NATIVE",
	kind: "agentic",
	note: "test entry",
	sources: ["test"],
	basis: "empirical",
	verified: true,
});

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

describe("buildRuntimeModelFleetSuggestions", () => {
	it("uses loaded LM Studio descriptors to surface family-diversity advice", async () => {
		const fetchLoadedModelDescriptors = vi.fn(async () => [
			{ runtimeId: "qwen-worker", modelKey: "qwen/qwen3-coder", isEmbedding: false },
			{ runtimeId: "qwen-judge", modelKey: "qwen/qwen3-30b-a3b", isEmbedding: false },
		]);

		const suggestions = await buildRuntimeModelFleetSuggestions({
			launchConfig: null,
			providerSettings: settings({
				providerId: "lmstudio",
				modelId: "qwen-worker",
				baseUrl: "http://127.0.0.1:1234/v1",
			}),
			fetchLoadedModelDescriptors,
			recommendationCatalog: [catalogEntry("devstral-small-2507")],
		});

		expect(fetchLoadedModelDescriptors).toHaveBeenCalledWith("http://127.0.0.1:1234/v1");
		expect(suggestions.map((suggestion) => suggestion.kind)).toContain("add_diverse_family");
		expect(suggestions.find((suggestion) => suggestion.kind === "add_diverse_family")?.detail).toContain(
			"devstral-small-2507",
		);
	});

	it("does not probe providers without LM Studio native model metadata", async () => {
		const fetchLoadedModelDescriptors = vi.fn(async () => [
			{ runtimeId: "qwen-worker", modelKey: "qwen/qwen3-coder", isEmbedding: false },
		]);

		const suggestions = await buildRuntimeModelFleetSuggestions({
			launchConfig: null,
			providerSettings: settings({
				providerId: "ollama",
				modelId: "qwen-worker",
				baseUrl: "http://127.0.0.1:11434",
			}),
			fetchLoadedModelDescriptors,
		});

		expect(fetchLoadedModelDescriptors).not.toHaveBeenCalled();
		expect(suggestions).toEqual([]);
	});
});

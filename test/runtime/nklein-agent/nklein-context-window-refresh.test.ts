import { describe, expect, it } from "vitest";
import {
	type RegistryEntryWindow,
	selectLiveContextWindowRefreshes,
} from "../../../src/nklein-agent/nklein-context-window-refresh";

function entry(
	modelId: string,
	advertised: number | null,
	endpoint: string | null = "http://localhost:1234",
	providerId = "lmstudio",
): RegistryEntryWindow {
	return { providerId, modelId, endpoint, contextWindow: { advertised } };
}

describe("selectLiveContextWindowRefreshes", () => {
	it("refreshes an entry whose advertised window differs from the live loaded window", () => {
		const out = selectLiveContextWindowRefreshes({
			providerId: "lmstudio",
			discoveredModels: [{ id: "m", contextWindow: 40000 }],
			registryEntries: [entry("m", 131072)],
		});
		expect(out).toEqual([
			{ providerId: "lmstudio", modelId: "m", endpoint: "http://localhost:1234", contextWindow: 40000 },
		]);
	});

	it("does not refresh when the registry already matches the loaded window (steady state = no writes)", () => {
		const out = selectLiveContextWindowRefreshes({
			providerId: "lmstudio",
			discoveredModels: [{ id: "m", contextWindow: 40000 }],
			registryEntries: [entry("m", 40000)],
		});
		expect(out).toEqual([]);
	});

	it("ignores a registry model that is not currently loaded", () => {
		const out = selectLiveContextWindowRefreshes({
			providerId: "lmstudio",
			discoveredModels: [{ id: "other", contextWindow: 8000 }],
			registryEntries: [entry("m", 131072)],
		});
		expect(out).toEqual([]);
	});

	it("ignores entries of a different provider", () => {
		const out = selectLiveContextWindowRefreshes({
			providerId: "lmstudio",
			discoveredModels: [{ id: "m", contextWindow: 40000 }],
			registryEntries: [entry("m", 131072, "http://x", "ollama")],
		});
		expect(out).toEqual([]);
	});

	it("skips discovered models with no / invalid context window", () => {
		const out = selectLiveContextWindowRefreshes({
			providerId: "lmstudio",
			discoveredModels: [{ id: "m", contextWindow: 0 }, { id: "n" }, { id: "p", contextWindow: null }],
			registryEntries: [entry("m", 131072), entry("n", 131072), entry("p", 131072)],
		});
		expect(out).toEqual([]);
	});

	it("preserves each entry's own endpoint + provider so the refresh updates it in place (case-insensitive provider match)", () => {
		const out = selectLiveContextWindowRefreshes({
			providerId: "LMStudio",
			discoveredModels: [
				{ id: "a", contextWindow: 40000 },
				{ id: "b", contextWindow: 32768 },
			],
			registryEntries: [entry("a", 131072, "http://h1"), entry("b", 65536, "http://h2")],
		});
		expect(out).toEqual([
			{ providerId: "lmstudio", modelId: "a", endpoint: "http://h1", contextWindow: 40000 },
			{ providerId: "lmstudio", modelId: "b", endpoint: "http://h2", contextWindow: 32768 },
		]);
	});

	it("truncates a fractional loaded window", () => {
		const out = selectLiveContextWindowRefreshes({
			providerId: "lmstudio",
			discoveredModels: [{ id: "m", contextWindow: 40000.9 }],
			registryEntries: [entry("m", 131072)],
		});
		expect(out[0]?.contextWindow).toBe(40000);
	});
});

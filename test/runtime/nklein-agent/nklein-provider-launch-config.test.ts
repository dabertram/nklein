import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Coverage for a module the extended coverage audit found unexercised (2026-08-08).
 *
 * This is the single dispatch chokepoint: every task session's provider, model, key, base url and context
 * window is resolved here, and BOTH prime directives are asserted here — the local-only lockdown and the ≥32k
 * context floor — before any OAuth refresh, key resolution, or model discovery happens.
 *
 * "Before" is the entire value of a chokepoint, and it is invisible in the return value. A lockdown that ran
 * after the OAuth refresh would still refuse the launch, having already refreshed a cloud token over the
 * network; a context check that ran on a CLAIMED window rather than the measured one would admit a model that
 * cannot hold a session. So the probes assert on the spies and on the arguments, not on the outcome.
 *
 * The local-only policy itself is left REAL rather than mocked, so the gate is exercised in both directions:
 * `lmstudio` is admitted and `nklein` is refused by the same code the product runs.
 */
const boundary = vi.hoisted(() => ({
	getSdkProviderSettings: vi.fn(),
	listSdkProviderCatalog: vi.fn(),
	SDK_DEFAULT_PROVIDER_ID: "ollama",
	SDK_DEFAULT_MODEL_ID: "sdk-default-model",
}));
const deps = vi.hoisted(() => ({
	assertNKleinContextWindowPolicy: vi.fn(),
	refreshManagedOauthSettings: vi.fn(),
	loadProviderModelsWithMeasuredWindows: vi.fn(),
	getSelectedProviderSettings: vi.fn(),
	resolveManagedProviderLaunchApiKey: vi.fn(),
}));

vi.mock("../../../src/nklein-agent/sdk-provider-boundary", () => boundary);
vi.mock("../../../src/nklein-agent/nklein-context-window-policy", () => ({
	assertNKleinContextWindowPolicy: deps.assertNKleinContextWindowPolicy,
}));
vi.mock("../../../src/nklein-agent/nklein-provider-oauth", () => ({
	refreshManagedOauthSettings: deps.refreshManagedOauthSettings,
}));
vi.mock("../../../src/nklein-agent/nklein-provider-model-discovery", () => ({
	loadProviderModelsWithMeasuredWindows: deps.loadProviderModelsWithMeasuredWindows,
}));
vi.mock("../../../src/nklein-agent/nklein-provider-selected-settings", () => ({
	getSelectedProviderSettings: deps.getSelectedProviderSettings,
	DEFAULT_NKLEIN_API_BASE_URL: "https://api.example.invalid",
}));
vi.mock("../../../src/nklein-agent/nklein-managed-provider-credentials", () => ({
	resolveManagedProviderLaunchApiKey: deps.resolveManagedProviderLaunchApiKey,
}));

const { resolveNKleinLaunchConfig } = await import("../../../src/nklein-agent/nklein-provider-launch-config");

const LOCAL = "lmstudio";
const loaded = (id: string, contextWindow = 131_072) => ({ id, contextWindow });

beforeEach(() => {
	// resetAllMocks, not clearAllMocks: the latter clears recorded calls but LEAVES implementations installed, so
	// the test that makes the context policy throw would poison every test after it.
	vi.resetAllMocks();
	deps.getSelectedProviderSettings.mockReturnValue({ provider: LOCAL, model: "qwen3-coder" });
	deps.refreshManagedOauthSettings.mockResolvedValue(null);
	deps.loadProviderModelsWithMeasuredWindows.mockResolvedValue([loaded("qwen3-coder")]);
	boundary.listSdkProviderCatalog.mockResolvedValue([{ id: LOCAL, defaultModelId: "catalog-default" }]);
	boundary.getSdkProviderSettings.mockReturnValue(null);
});

describe("the local-only lockdown is the FIRST thing that happens", () => {
	it("refuses a cloud provider without refreshing OAuth or discovering models", async () => {
		// THE probe. A lockdown placed after the refresh would still refuse the launch, having already taken a
		// cloud token over the network — the refusal proves nothing about the egress.
		deps.getSelectedProviderSettings.mockReturnValue({ provider: "nklein", model: "m" });

		await expect(resolveNKleinLaunchConfig()).rejects.toThrow();
		expect(deps.refreshManagedOauthSettings).not.toHaveBeenCalled();
		expect(deps.loadProviderModelsWithMeasuredWindows).not.toHaveBeenCalled();
		expect(deps.resolveManagedProviderLaunchApiKey).not.toHaveBeenCalled();
		expect(deps.assertNKleinContextWindowPolicy).not.toHaveBeenCalled();
	});

	it("refuses a cloud provider reached through the OVERRIDE path too", async () => {
		// The override bypasses the selected-settings read entirely; a gate wired only into the default path would
		// leave a second way in.
		boundary.getSdkProviderSettings.mockReturnValue({ provider: "nklein" });

		await expect(resolveNKleinLaunchConfig({ providerIdOverride: "nklein" })).rejects.toThrow();
		expect(deps.refreshManagedOauthSettings).not.toHaveBeenCalled();
	});

	it("admits a local provider through the same real policy", async () => {
		await expect(resolveNKleinLaunchConfig()).resolves.toMatchObject({ providerId: LOCAL });
	});
});

describe("the context-window floor", () => {
	it("is asserted with the MEASURED window, not one the model claims", async () => {
		// The floor is only meaningful against a measured value; asserting a claimed one admits a model that
		// cannot actually hold a session, and the failure then appears much later as a session that never starts.
		deps.loadProviderModelsWithMeasuredWindows.mockResolvedValue([loaded("qwen3-coder", 40_960)]);
		await resolveNKleinLaunchConfig();

		expect(deps.assertNKleinContextWindowPolicy).toHaveBeenCalledWith(
			expect.objectContaining({ providerId: LOCAL, modelId: "qwen3-coder", contextWindow: 40_960 }),
		);
	});

	it("passes NULL rather than a guess when the model was never discovered", async () => {
		// The absence has to reach the policy as an absence. Substituting a default here is the green-signal move:
		// it would let an unmeasured model through the one check that exists to stop it.
		deps.loadProviderModelsWithMeasuredWindows.mockResolvedValue([]);
		// A custom provider id is admitted by the real policy only when its endpoint is local — hence the loopback
		// base url rather than an invented "local-sounding" name.
		boundary.listSdkProviderCatalog.mockResolvedValue([{ id: "customlocal", defaultModelId: null }]);
		deps.getSelectedProviderSettings.mockReturnValue({
			provider: "customlocal",
			model: "unknown-model",
			baseUrl: "http://127.0.0.1:1234",
		});

		await resolveNKleinLaunchConfig();

		expect(deps.assertNKleinContextWindowPolicy).toHaveBeenCalledWith(
			expect.objectContaining({ contextWindow: null }),
		);
	});

	it("propagates the policy's refusal instead of launching anyway", async () => {
		deps.assertNKleinContextWindowPolicy.mockImplementation(() => {
			throw new Error("requires at least 32,000");
		});

		await expect(resolveNKleinLaunchConfig()).rejects.toThrow(/32,000/);
	});
});

describe("a live-only provider's model must actually be loaded", () => {
	it("names the model and says what to do about it", async () => {
		// LM Studio serves only loaded models, so dispatching to an unloaded one fails deep in a session with an
		// opaque error. Catching it here, by name, is the difference between an actionable message and a hunt.
		deps.loadProviderModelsWithMeasuredWindows.mockResolvedValue([loaded("something-else")]);

		await expect(resolveNKleinLaunchConfig()).rejects.toThrow(/"qwen3-coder" is not currently loaded/);
	});

	it("does not reach the context policy once it has refused", async () => {
		deps.loadProviderModelsWithMeasuredWindows.mockResolvedValue([]);

		await expect(resolveNKleinLaunchConfig()).rejects.toThrow(/not currently loaded/);
		expect(deps.assertNKleinContextWindowPolicy).not.toHaveBeenCalled();
	});
});

describe("which model gets dispatched", () => {
	it("prefers an explicit override over the stored selection", async () => {
		deps.loadProviderModelsWithMeasuredWindows.mockResolvedValue([loaded("override-model")]);
		const config = await resolveNKleinLaunchConfig({ modelIdOverride: "  override-model  " });

		expect(config.modelId).toBe("override-model");
	});

	it("falls back to the provider CATALOG default when nothing is selected", async () => {
		deps.getSelectedProviderSettings.mockReturnValue({ provider: LOCAL });
		deps.loadProviderModelsWithMeasuredWindows.mockResolvedValue([loaded("catalog-default")]);
		const config = await resolveNKleinLaunchConfig();

		expect(config.modelId).toBe("catalog-default");
	});

	it("falls back to the built-in default when the CATALOG READ ITSELF fails", async () => {
		// A catalog fetch is I/O and can fail; collapsing to "no model" would turn a transient read error into an
		// unstartable card.
		boundary.listSdkProviderCatalog.mockRejectedValue(new Error("catalog unreachable"));
		deps.getSelectedProviderSettings.mockReturnValue({ provider: boundary.SDK_DEFAULT_PROVIDER_ID });
		deps.loadProviderModelsWithMeasuredWindows.mockResolvedValue([loaded(boundary.SDK_DEFAULT_MODEL_ID)]);

		const config = await resolveNKleinLaunchConfig();
		expect(config.modelId).toBe(boundary.SDK_DEFAULT_MODEL_ID);
	});

	it("yields a null model rather than inventing one for an unknown provider", async () => {
		// Deliberately NOT the SDK default provider, which has a built-in fallback of its own.
		boundary.listSdkProviderCatalog.mockResolvedValue([]);
		deps.getSelectedProviderSettings.mockReturnValue({ provider: "customlocal", baseUrl: "http://127.0.0.1:1234" });
		deps.loadProviderModelsWithMeasuredWindows.mockResolvedValue([]);

		expect((await resolveNKleinLaunchConfig()).modelId).toBeNull();
	});
});

describe("reasoning effort: unspecified is not the same as none", () => {
	it("uses the stored effort when the caller says nothing about it", async () => {
		deps.getSelectedProviderSettings.mockReturnValue({
			provider: LOCAL,
			model: "qwen3-coder",
			reasoning: { effort: "high" },
		});

		expect((await resolveNKleinLaunchConfig()).reasoningEffort).toBe("high");
	});

	it("honours an EXPLICIT undefined override as 'no effort', not as 'unspecified'", async () => {
		// The distinction the module makes with an `in` check rather than a `??`. A caller that deliberately
		// clears the effort must not have the stored value quietly reinstated — the two are indistinguishable to a
		// nullish check and mean opposite things.
		deps.getSelectedProviderSettings.mockReturnValue({
			provider: LOCAL,
			model: "qwen3-coder",
			reasoning: { effort: "high" },
		});

		const config = await resolveNKleinLaunchConfig({ reasoningEffortOverride: undefined });
		expect(config.reasoningEffort).toBeNull();
	});

	it("passes an explicit effort through", async () => {
		expect((await resolveNKleinLaunchConfig({ reasoningEffortOverride: "low" })).reasoningEffort).toBe("low");
	});
});

describe("the rest of the resolved config", () => {
	it("normalises the provider id, and trims a blank base url to null", async () => {
		deps.getSelectedProviderSettings.mockReturnValue({
			provider: "  LMStudio  ",
			model: "qwen3-coder",
			baseUrl: "   ",
		});

		const config = await resolveNKleinLaunchConfig();
		expect(config.providerId).toBe(LOCAL);
		expect(config.baseUrl).toBeNull();
	});

	it("prefers the settings the OAuth refresh returned over the stale ones", async () => {
		// A refresh exists to replace what was there; resolving from the pre-refresh copy would dispatch with the
		// credential the refresh had just superseded.
		deps.refreshManagedOauthSettings.mockResolvedValue({
			settings: { provider: LOCAL, model: "qwen3-coder", apiKey: "refreshed-key", baseUrl: "http://new:1234" },
			apiKey: null,
		});

		const config = await resolveNKleinLaunchConfig();
		expect(config.apiKey).toBe("refreshed-key");
		expect(config.baseUrl).toBe("http://new:1234");
	});

	it("refuses with an ACTIONABLE message when no provider is configured", async () => {
		// This is what a first-run user hits. "undefined is not an object" would be technically accurate and
		// completely useless.
		deps.getSelectedProviderSettings.mockReturnValue(null);

		await expect(resolveNKleinLaunchConfig()).rejects.toThrow(/Open Settings, choose a provider/);
	});

	it("refuses a settings record whose provider id is blank", async () => {
		deps.getSelectedProviderSettings.mockReturnValue({ provider: "   ", model: "m" });

		await expect(resolveNKleinLaunchConfig()).rejects.toThrow(/Open Settings, choose a provider/);
	});
});

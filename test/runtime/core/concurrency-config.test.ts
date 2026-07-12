import { describe, expect, it } from "vitest";
import {
	areConcurrencyConfigsEqual,
	areConcurrencyOverridesEqual,
	type ConcurrencyConfig,
	concurrencyConfigSchema,
	concurrencyOverrideSchema,
	DEFAULT_CONCURRENCY_CONFIG,
	DEFAULT_HOST_CONCURRENCY_CAP,
	normalizeConcurrencyConfig,
	normalizeConcurrencyMap,
	normalizeConcurrencyOverride,
	resolveEffectiveHostConcurrency,
	resolveEffectiveModelConcurrency,
	resolveEffectiveProviderConcurrency,
	resolveExplicitHostConcurrency,
	resolveSessionConcurrencyCaps,
} from "../../../src/core/concurrency-config";

describe("concurrency config/override equality (change-detection helpers)", () => {
	it("DEFAULT_CONCURRENCY_CONFIG is empty grains", () => {
		expect(DEFAULT_CONCURRENCY_CONFIG).toEqual({ perProvider: {}, perModel: {} });
	});

	it("areConcurrencyConfigsEqual compares both grains key-by-key", () => {
		expect(
			areConcurrencyConfigsEqual({ perProvider: { a: 2 }, perModel: {} }, { perProvider: { a: 2 }, perModel: {} }),
		).toBe(true);
		expect(
			areConcurrencyConfigsEqual({ perProvider: { a: 2 }, perModel: {} }, { perProvider: { a: 3 }, perModel: {} }),
		).toBe(false);
		expect(
			areConcurrencyConfigsEqual({ perProvider: {}, perModel: { m: 1 } }, { perProvider: {}, perModel: {} }),
		).toBe(false);
		expect(
			areConcurrencyConfigsEqual(
				{ perProvider: {}, perModel: {}, perHost: { local: 2 } },
				{ perProvider: {}, perModel: {}, perHost: { local: 3 } },
			),
		).toBe(false);
	});

	it("areConcurrencyOverridesEqual is null-aware", () => {
		expect(areConcurrencyOverridesEqual(null, null)).toBe(true);
		expect(areConcurrencyOverridesEqual(null, { perProvider: { a: 1 } })).toBe(false);
		expect(areConcurrencyOverridesEqual({ perModel: { m: 1 } }, { perModel: { m: 1 } })).toBe(true);
		expect(areConcurrencyOverridesEqual({ perModel: { m: 1 } }, { perModel: { m: 2 } })).toBe(false);
		expect(areConcurrencyOverridesEqual({ perHost: { local: 1 } }, { perHost: { local: 1 } })).toBe(true);
	});
});

describe("concurrency wire schemas", () => {
	it("parses a config with both grains", () => {
		expect(
			concurrencyConfigSchema.parse({ perProvider: { ollama: 2 }, perModel: {}, perHost: { local: 2 } }),
		).toEqual({
			perProvider: { ollama: 2 },
			perModel: {},
			perHost: { local: 2 },
		});
	});

	it("round-trips a normalized config", () => {
		const normalized = normalizeConcurrencyConfig({ perProvider: { lmstudio: 3 }, perModel: { "lmstudio:m:e": 1 } });
		expect(concurrencyConfigSchema.parse(normalized)).toEqual(normalized);
	});

	it("accepts a nullable-per-grain project override (incl. absent)", () => {
		expect(concurrencyOverrideSchema.parse({ perProvider: { ollama: 1 }, perModel: null, perHost: null })).toEqual({
			perProvider: { ollama: 1 },
			perModel: null,
			perHost: null,
		});
		expect(concurrencyOverrideSchema.parse({})).toEqual({});
	});
});

describe("normalizeConcurrencyMap", () => {
	it("drops blank keys + out-of-range values and clamps to [1, 256]", () => {
		expect(
			normalizeConcurrencyMap({ lmstudio: 4, ollama: 0, "  ": 3, bad: -2, huge: 9999, frac: 2.9, nope: "x" }),
		).toEqual({ huge: 256, lmstudio: 4, frac: 2 });
	});

	it("returns an empty map for non-objects", () => {
		expect(normalizeConcurrencyMap(null)).toEqual({});
		expect(normalizeConcurrencyMap([1, 2])).toEqual({});
		expect(normalizeConcurrencyMap("nope")).toEqual({});
	});
});

describe("normalizeConcurrencyConfig", () => {
	it("normalizes both grains", () => {
		expect(
			normalizeConcurrencyConfig({ perProvider: { lmstudio: 2 }, perModel: { "lmstudio:qwen3-8b:default": 3 } }),
		).toEqual({ perProvider: { lmstudio: 2 }, perModel: { "lmstudio:qwen3-8b:default": 3 } });
		expect(normalizeConcurrencyConfig(null)).toEqual({ perProvider: {}, perModel: {} });
	});

	it("carries host + per-ENDPOINT grains sparsely + round-trips through the wire schema (§5.AB threading)", () => {
		const withPool = normalizeConcurrencyConfig({
			perProvider: {},
			perModel: {},
			perHost: { local: 2, "m4mini-device": 1 },
			perEndpoint: { "http://m4mini.local:1234/v1": 2 },
		});
		expect(withPool).toEqual({
			perProvider: {},
			perModel: {},
			perHost: { local: 2, "m4mini-device": 1 },
			perEndpoint: { "http://m4mini.local:1234/v1": 2 },
		});
		// Threaded via the same concurrencyConfigSchema the runtime-config + tRPC contract use → round-trips intact.
		expect(concurrencyConfigSchema.parse(withPool)).toEqual(withPool);
		// SPARSE: a config without host/pool caps stays the exact 2-grain shape (no round-trip drift).
		expect(normalizeConcurrencyConfig({ perProvider: { lmstudio: 2 }, perModel: {} })).toEqual({
			perProvider: { lmstudio: 2 },
			perModel: {},
		});
	});
});

describe("normalizeConcurrencyOverride (null-when-empty)", () => {
	it("returns null when the override adds nothing", () => {
		expect(normalizeConcurrencyOverride(null)).toBeNull();
		expect(normalizeConcurrencyOverride({})).toBeNull();
		expect(normalizeConcurrencyOverride({ perProvider: {}, perModel: { "": 1 } })).toBeNull();
	});

	it("keeps only the grains that have entries", () => {
		expect(normalizeConcurrencyOverride({ perProvider: { lmstudio: 8 } })).toEqual({ perProvider: { lmstudio: 8 } });
		expect(normalizeConcurrencyOverride({ perModel: { m: 2 }, perProvider: {} })).toEqual({ perModel: { m: 2 } });
		expect(normalizeConcurrencyOverride({ perHost: { local: 3 }, perEndpoint: {} })).toEqual({
			perHost: { local: 3 },
		});
	});
});

describe("resolveEffectiveProviderConcurrency (override ?? global)", () => {
	const global: ConcurrencyConfig = { perProvider: { lmstudio: 2, ollama: 4 }, perModel: {} };

	it("project override beats the global default", () => {
		expect(
			resolveEffectiveProviderConcurrency("lmstudio", { global, override: { perProvider: { lmstudio: 6 } } }),
		).toBe(6);
	});

	it("falls back to the global default when no override", () => {
		expect(resolveEffectiveProviderConcurrency("ollama", { global })).toBe(4);
	});

	it("returns null when no layer sets a cap", () => {
		expect(resolveEffectiveProviderConcurrency("unknown", { global })).toBeNull();
	});
});

describe("resolveEffectiveModelConcurrency (override ?? global ?? registry fallback)", () => {
	const global: ConcurrencyConfig = { perProvider: {}, perModel: { "p:a:default": 3 } };

	it("uses the registry fallback when neither override nor global sets the model", () => {
		expect(resolveEffectiveModelConcurrency("p:b:default", { global, registryFallback: 2 })).toBe(2);
	});

	it("global beats the registry fallback", () => {
		expect(resolveEffectiveModelConcurrency("p:a:default", { global, registryFallback: 99 })).toBe(3);
	});

	it("override beats global + the registry fallback", () => {
		expect(
			resolveEffectiveModelConcurrency("p:a:default", {
				global,
				override: { perModel: { "p:a:default": 7 } },
				registryFallback: 99,
			}),
		).toBe(7);
	});

	it("null when nothing applies", () => {
		expect(resolveEffectiveModelConcurrency("p:z:default", { global })).toBeNull();
	});
});

describe("resolveEffectiveHostConcurrency (override ?? global ?? env fallback)", () => {
	const global: ConcurrencyConfig = { perProvider: {}, perModel: {}, perHost: { local: 2, "m4mini-device": 1 } };

	it("project override beats the global host cap", () => {
		expect(resolveEffectiveHostConcurrency("local", { global, override: { perHost: { local: 4 } } })).toBe(4);
	});

	it("global beats the uniform fallback", () => {
		expect(resolveEffectiveHostConcurrency("m4mini-device", { global, fallback: 9 })).toBe(1);
	});

	it("uses the fallback when no configured host cap exists", () => {
		expect(resolveEffectiveHostConcurrency("legion-device", { global, fallback: 3 })).toBe(3);
	});

	it("defaults to DEFAULT_HOST_CONCURRENCY_CAP=1 with no layers at all (§10c#5+6 default-ON)", () => {
		expect(resolveEffectiveHostConcurrency("unconfigured-host", {})).toBe(DEFAULT_HOST_CONCURRENCY_CAP);
		expect(DEFAULT_HOST_CONCURRENCY_CAP).toBe(1);
	});

	it("resolveExplicitHostConcurrency stays null without explicit layers (surfaces distinguish default from chosen)", () => {
		expect(resolveExplicitHostConcurrency("unconfigured-host", {})).toBeNull();
		expect(resolveExplicitHostConcurrency("legion-device", { global, fallback: 3 })).toBe(3);
		expect(resolveExplicitHostConcurrency("local", { global })).toBe(2);
	});
});

describe("resolveSessionConcurrencyCaps (both grains independent)", () => {
	it("resolves provider + model caps from the right layers", () => {
		const global: ConcurrencyConfig = {
			perProvider: { lmstudio: 2 },
			perModel: { "lmstudio:qwen3-8b:default": 1 },
		};
		expect(
			resolveSessionConcurrencyCaps({
				providerId: "lmstudio",
				modelId: "lmstudio:coder:default",
				global,
				override: { perModel: { "lmstudio:coder:default": 4 } },
				registryModelFallback: 9,
			}),
		).toEqual({ providerCap: 2, modelCap: 4, hostCap: null, endpointCap: null });
	});

	it("null caps when no layer constrains the session", () => {
		expect(resolveSessionConcurrencyCaps({ providerId: "ollama", modelId: "ollama:x:default" })).toEqual({
			providerCap: null,
			modelCap: null,
			hostCap: null,
			endpointCap: null,
		});
	});

	it("resolves the per-HOST cap from lms machine id, with a uniform fallback", () => {
		const global: ConcurrencyConfig = {
			perProvider: {},
			perModel: {},
			perHost: { local: 2 },
		};
		expect(
			resolveSessionConcurrencyCaps({
				providerId: "lmstudio",
				modelId: "lmstudio:qwen:default",
				hostId: "local",
				global,
				hostFallback: 1,
			}).hostCap,
		).toBe(2);
		expect(
			resolveSessionConcurrencyCaps({
				providerId: "lmstudio",
				modelId: "lmstudio:qwen:default",
				hostId: "m4mini-device",
				global,
				hostFallback: 1,
			}).hostCap,
		).toBe(1);
	});

	it("resolves the per-ENDPOINT (machine-pool) cap when an endpoint is given (§5.AB per-machine pools)", () => {
		const global: ConcurrencyConfig = {
			perProvider: {},
			perModel: {},
			perEndpoint: { "http://m4mini.local:1234/v1": 2, "http://m5max.local:1234/v1": 6 },
		};
		expect(
			resolveSessionConcurrencyCaps({
				providerId: "lmstudio",
				modelId: "lmstudio:small:default",
				endpoint: "http://m4mini.local:1234/v1",
				global,
			}),
		).toEqual({ providerCap: null, modelCap: null, hostCap: null, endpointCap: 2 });
		// A project override wins for its pool; absent endpoint ⇒ no endpoint gate.
		expect(
			resolveSessionConcurrencyCaps({
				providerId: "lmstudio",
				modelId: "lmstudio:small:default",
				endpoint: "http://m5max.local:1234/v1",
				global,
				override: { perEndpoint: { "http://m5max.local:1234/v1": 3 } },
			}).endpointCap,
		).toBe(3);
		expect(resolveSessionConcurrencyCaps({ providerId: "lmstudio", modelId: "m", global }).endpointCap).toBe(null);
	});
});

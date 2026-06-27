import { describe, expect, it } from "vitest";
import type { NKleinModelRegistryEntry } from "../../../src/nklein-agent/nklein-model-registry";
import type { ResolvedNKleinLaunchConfig } from "../../../src/nklein-agent/nklein-provider-service";
import type { NKleinStartGuardCandidate } from "../../../src/nklein-agent/nklein-task-start-guard";
import { applyCandidateEffectiveContextWindow } from "../../../src/trpc/runtime-api/start-task-session";

function entryWithContextWindow(effective: number | null): NKleinModelRegistryEntry {
	return {
		key: "lmstudio:m:default",
		providerId: "lmstudio",
		modelId: "m",
		endpoint: "default",
		contextWindow: { advertised: effective, observed: null, userOverride: null, effective },
		speed: {
			samples: 0,
			promptTokensEwma: null,
			outputTokensEwma: null,
			totalTokensEwma: null,
			prefillTokensPerSecondEwma: null,
			decodeTokensPerSecondEwma: null,
			ttftMsEwma: null,
			wallTimeMsEwma: null,
			wallTimeMsPer1kPromptTokensEwma: null,
			lastPromptTokens: null,
			lastOutputTokens: null,
			lastWallTimeMs: null,
			lastObservedAt: null,
		},
		capability: {
			samples: 0,
			staticPrior: 50,
			evalScore: null,
			externalScore: null,
			observedPassRate: null,
			effectiveScore: 50,
			lastObservedAt: null,
		},
		constraints: {
			sharedEndpointId: "default",
			inputCostPerMillionTokens: null,
			outputCostPerMillionTokens: null,
			maxConcurrentRequests: null,
		},
		createdAt: 1,
		updatedAt: 1,
	};
}

function launchConfig(contextWindow: number | null): ResolvedNKleinLaunchConfig {
	return { contextWindow } as ResolvedNKleinLaunchConfig;
}

function candidate(
	effective: number | null,
	config: ResolvedNKleinLaunchConfig,
): NKleinStartGuardCandidate<ResolvedNKleinLaunchConfig> {
	return { entry: entryWithContextWindow(effective), role: null, launchConfig: config };
}

describe("applyCandidateEffectiveContextWindow", () => {
	it("applies a valid effective window that differs from the launch config", () => {
		const config = launchConfig(8_000);
		const result = applyCandidateEffectiveContextWindow(config, candidate(32_000, config));
		expect(result.contextWindow).toBe(32_000);
		expect(result).not.toBe(config); // a new object
	});

	it("leaves the launch config untouched when the window already matches", () => {
		const config = launchConfig(32_000);
		expect(applyCandidateEffectiveContextWindow(config, candidate(32_000, config))).toBe(config);
	});

	it("ignores an invalid effective window (null / 0 / negative)", () => {
		for (const bad of [null, 0, -5]) {
			const config = launchConfig(8_000);
			expect(applyCandidateEffectiveContextWindow(config, candidate(bad, config))).toBe(config);
		}
	});
});

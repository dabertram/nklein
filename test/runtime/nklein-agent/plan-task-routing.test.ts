import { describe, expect, it } from "vitest";
import {
	estimateTaskWallTimeMs,
	formatTaskModelFitEvidence,
} from "../../../src/nklein-agent/decomposition/plan-task-routing";
import type { NKleinModelRegistryEntry } from "../../../src/nklein-agent/nklein-model-registry";
import type { NKleinTaskRoutingCandidate } from "../../../src/nklein-agent/nklein-task-router";

function createEntry(input: {
	key: string;
	capability: number;
	contextWindow: number;
	prefillTokensPerSecond?: number | null;
	decodeTokensPerSecond?: number | null;
	ttftMs?: number | null;
	wallTimeMs?: number | null;
}): NKleinModelRegistryEntry {
	const [providerId = "provider", modelId = input.key, endpoint = "default"] = input.key.split(":");
	return {
		key: input.key,
		providerId,
		modelId,
		endpoint,
		contextWindow: {
			advertised: input.contextWindow,
			observed: null,
			userOverride: null,
			effective: input.contextWindow,
		},
		speed: {
			samples: 1,
			promptTokensEwma: null,
			outputTokensEwma: null,
			totalTokensEwma: null,
			prefillTokensPerSecondEwma: input.prefillTokensPerSecond ?? null,
			decodeTokensPerSecondEwma: input.decodeTokensPerSecond ?? null,
			ttftMsEwma: input.ttftMs ?? null,
			wallTimeMsEwma: input.wallTimeMs ?? null,
			wallTimeMsPer1kPromptTokensEwma: null,
			lastPromptTokens: null,
			lastOutputTokens: null,
			lastWallTimeMs: null,
			lastObservedAt: null,
		},
		capability: {
			samples: 1,
			staticPrior: input.capability,
			evalScore: null,
			externalScore: null,
			observedPassRate: null,
			effectiveScore: input.capability,
			lastObservedAt: null,
		},
		constraints: {
			sharedEndpointId: endpoint,
			inputCostPerMillionTokens: null,
			outputCostPerMillionTokens: null,
			maxConcurrentRequests: null,
		},
		createdAt: 1,
		updatedAt: 1,
	};
}

function candidate(
	over: Partial<{ entry: NKleinModelRegistryEntry; role: string | null }> = {},
): NKleinTaskRoutingCandidate {
	return {
		entry: over.entry ?? createEntry({ key: "lmstudio:qwen3-8b:default", capability: 72, contextWindow: 32_768 }),
		role: over.role ?? null,
	};
}

describe("formatTaskModelFitEvidence", () => {
	it("explains the not-yet-validated and default-model cases", () => {
		expect(formatTaskModelFitEvidence(undefined)).toMatch(/not validated before card creation/u);
		expect(formatTaskModelFitEvidence(null)).toMatch(/default local model/u);
	});

	it("names the provider/model and includes role, context, and capability for a real candidate", () => {
		const evidence = formatTaskModelFitEvidence(candidate({ role: "worker" }));
		expect(evidence).toContain("lmstudio / qwen3-8b");
		expect(evidence).toContain("role worker");
		expect(evidence).toContain("context 32,768"); // toLocaleString
		expect(evidence).toContain("capability 72");
	});
});

describe("estimateTaskWallTimeMs", () => {
	it("is null without a candidate", () => {
		expect(estimateTaskWallTimeMs(null, 1000)).toBeNull();
		expect(estimateTaskWallTimeMs(undefined, 1000)).toBeNull();
	});

	it("estimates from prefill + decode speed + ttft", () => {
		const c = candidate({
			entry: createEntry({
				key: "lmstudio:m:default",
				capability: 50,
				contextWindow: 8_000,
				prefillTokensPerSecond: 500,
				decodeTokensPerSecond: 50,
				ttftMs: 200,
			}),
		});
		// prefill (1000/500*1000? no): (promptTokens/prefill)*1000 = (500/500)*1000 = 1000; decode (1000/50)*1000 = 20000; + ttft 200
		expect(estimateTaskWallTimeMs(c, 500)).toBe(21_200);
	});

	it("falls back to the wall-time EWMA when prefill/decode speed is unknown", () => {
		const c = candidate({
			entry: createEntry({ key: "lmstudio:m:default", capability: 50, contextWindow: 8_000, wallTimeMs: 9_999 }),
		});
		expect(estimateTaskWallTimeMs(c, 500)).toBe(9_999);
	});
});

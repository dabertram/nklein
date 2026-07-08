import { describe, expect, it } from "vitest";
import {
	dominantFailureMode,
	emptyModelBehaviorProfile,
	learnedQualityEffectiveBudget,
	learnedRetryBudget,
	type ModelAttemptOutcome,
	preferredPromptVariantFamily,
	preferredToolCallFormat,
	recordModelBehaviorOutcome,
} from "../../../src/core/model-behavior-profile";

function fold(outcomes: ModelAttemptOutcome[], alpha = 0.5) {
	let profile = emptyModelBehaviorProfile("lmstudio:qwen3-8b:default");
	for (const outcome of outcomes) {
		profile = recordModelBehaviorOutcome(profile, outcome, { alpha, now: () => 100 });
	}
	return profile;
}

describe("recordModelBehaviorOutcome", () => {
	it("tracks success rate + sample/success counts via EWMA", () => {
		const profile = fold([{ kind: "success" }, { kind: "success" }, { kind: "timeout" }]);
		expect(profile.samples).toBe(3);
		expect(profile.successes).toBe(2);
		// EWMA(α=.5): 1 → 1 → 0.5 (after the timeout)
		expect(profile.successRate).toBeCloseTo(0.5, 5);
		expect(profile.updatedAt).toBe(100);
	});

	it("counts failure modes (success excluded) and finds the dominant one", () => {
		const profile = fold([{ kind: "no_tool_call" }, { kind: "no_tool_call" }, { kind: "loop" }, { kind: "success" }]);
		expect(profile.failureModes.no_tool_call).toBe(2);
		expect(profile.failureModes.loop).toBe(1);
		expect(profile.failureModes.success).toBe(0);
		expect(dominantFailureMode(profile)).toBe("no_tool_call");
	});

	it("learns the preferred tool-call format from successes only", () => {
		const profile = fold([
			{ kind: "success", toolCallFormat: "native" },
			{ kind: "success", toolCallFormat: "narrated" },
			{ kind: "success", toolCallFormat: "native" },
			{ kind: "no_tool_call", toolCallFormat: "phi" },
		]);
		expect(preferredToolCallFormat(profile)).toBe("native");
		expect(profile.toolCallFormatCounts.phi).toBeUndefined();
	});

	it("ratchets the complexity ceiling to the largest tool count cleared on success", () => {
		const profile = fold([
			{ kind: "success", toolCount: 2 },
			{ kind: "success", toolCount: 6 },
			{ kind: "no_tool_call", toolCount: 9 }, // failure doesn't raise the ceiling
			{ kind: "success", toolCount: 4 },
		]);
		expect(profile.complexityCeiling).toBe(6);
	});

	it("never mutates the input profile", () => {
		const base = emptyModelBehaviorProfile("m");
		const next = recordModelBehaviorOutcome(base, { kind: "success" });
		expect(base.samples).toBe(0);
		expect(next.samples).toBe(1);
	});
});

describe("learnedRetryBudget", () => {
	it("cold start (no samples) returns the min budget", () => {
		expect(learnedRetryBudget(emptyModelBehaviorProfile("m"))).toBe(1);
	});

	it("a reliable, zero-retry model gets a small budget", () => {
		const profile = fold([
			{ kind: "success", retries: 0 },
			{ kind: "success", retries: 0 },
		]);
		expect(learnedRetryBudget(profile)).toBe(1);
	});

	it("a flaky model (low success rate) earns more retries than a reliable one", () => {
		const flaky = fold([{ kind: "timeout" }, { kind: "timeout" }, { kind: "success" }, { kind: "timeout" }]);
		const reliable = fold([{ kind: "success" }, { kind: "success" }, { kind: "success" }, { kind: "success" }]);
		expect(learnedRetryBudget(flaky)).toBeGreaterThan(learnedRetryBudget(reliable));
	});

	it("clamps to the configured max", () => {
		const hopeless = fold([
			{ kind: "timeout", retries: 10 },
			{ kind: "timeout", retries: 10 },
		]);
		expect(learnedRetryBudget(hopeless, { maxBudget: 4 })).toBe(4);
	});
});

describe("learnedQualityEffectiveBudget", () => {
	it("returns null when nothing about quality-vs-context is known", () => {
		expect(learnedQualityEffectiveBudget(emptyModelBehaviorProfile("m"))).toBeNull();
	});

	it("targets just below the first observed degradation, never below the floor", () => {
		// degraded at 100k → 0.9*100k = 90k, above the 32k floor.
		const profile = fold([{ kind: "no_tool_call", contextTokens: 100_000, qualityOk: false }]);
		expect(learnedQualityEffectiveBudget(profile)).toBe(90_000);
	});

	it("never returns below the ≥32k floor even when degradation is observed very low", () => {
		const profile = fold([{ kind: "other_failure", contextTokens: 20_000, qualityOk: false }]);
		expect(learnedQualityEffectiveBudget(profile)).toBe(32_000);
	});

	it("falls back to the best-observed good context when no degradation is known", () => {
		const profile = fold([{ kind: "success", contextTokens: 48_000, qualityOk: true }]);
		expect(learnedQualityEffectiveBudget(profile)).toBe(48_000);
	});
});

describe("prompt-variant family learning (§5.AA prompt-variation persistence)", () => {
	it("counts the winning family on success and exposes the mode as the preferred family", () => {
		let profile = emptyModelBehaviorProfile("lmstudio:m:v1");
		profile = recordModelBehaviorOutcome(profile, { kind: "success", promptVariantFamily: "example_led" });
		profile = recordModelBehaviorOutcome(profile, { kind: "success", promptVariantFamily: "imperative" });
		profile = recordModelBehaviorOutcome(profile, { kind: "success", promptVariantFamily: "example_led" });
		expect(profile.promptVariantFamilyCounts).toEqual({ example_led: 2, imperative: 1 });
		expect(preferredPromptVariantFamily(profile)).toBe("example_led");
	});

	it("ignores the family on a FAILED attempt (only a family that WON is worth learning)", () => {
		let profile = emptyModelBehaviorProfile("lmstudio:m:v1");
		profile = recordModelBehaviorOutcome(profile, { kind: "no_tool_call", promptVariantFamily: "imperative" });
		expect(profile.promptVariantFamilyCounts).toEqual({});
		expect(preferredPromptVariantFamily(profile)).toBeNull();
	});

	it("tolerates a legacy profile persisted WITHOUT the counts field", () => {
		const legacy = { ...emptyModelBehaviorProfile("lmstudio:m:v1") } as Record<string, unknown>;
		delete legacy.promptVariantFamilyCounts;
		const folded = recordModelBehaviorOutcome(legacy as never, {
			kind: "success",
			promptVariantFamily: "imperative",
		});
		expect(folded.promptVariantFamilyCounts).toEqual({ imperative: 1 });
	});
});

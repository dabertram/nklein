import { describe, expect, it } from "vitest";
import { runtimeModelBehaviorProfilesResponseSchema } from "../../../src/core/telemetry-stats-api-contract";

describe("runtimeModelBehaviorProfilesResponseSchema (§5.AA Settings telemetry surface)", () => {
	it("parses a populated profiles response (the runtime-api projection shape)", () => {
		const parsed = runtimeModelBehaviorProfilesResponseSchema.parse({
			generatedAt: 1_700_000_000_000,
			profiles: [
				{
					modelId: "lmstudio:qwen3-8b:default",
					samples: 12,
					successes: 9,
					successRate: 0.78,
					avgRetries: 1.2,
					dominantFailureMode: "no_tool_call",
					preferredToolCallFormat: "native",
					preferredPromptVariantFamily: "example_led",
					complexityCeiling: 6,
					qualityEffectiveContextTokens: 24_000,
					qualityDegradedAtTokens: 48_000,
					updatedAt: 1_700_000_000_000,
				},
			],
		});
		expect(parsed.profiles[0]?.preferredPromptVariantFamily).toBe("example_led");
	});

	it("parses an empty cold-start response and rejects a profile missing its model id", () => {
		expect(runtimeModelBehaviorProfilesResponseSchema.parse({ generatedAt: 0, profiles: [] }).profiles).toEqual([]);
		expect(() =>
			runtimeModelBehaviorProfilesResponseSchema.parse({
				generatedAt: 0,
				profiles: [{ samples: 1 }],
			}),
		).toThrow();
	});
});

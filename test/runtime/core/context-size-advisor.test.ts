import { describe, expect, it } from "vitest";
import {
	adviseContextSizes,
	buildContextSizeObservations,
	type ContextSizeObservation,
	formatContextSizeAdvice,
	recommendContextSizeForObservation,
} from "../../../src/core/context-size-advisor";
import { MIN_CONTEXT_FLOOR_TOKENS } from "../../../src/core/turn-budget-allocator";

/** A well-sampled, over-provisioned + slow observation (the target reduce case) unless overridden. */
function obs(overrides: Partial<ContextSizeObservation> = {}): ContextSizeObservation {
	return {
		modelId: "qwen/qwen2.5-coder-14b",
		hostId: "m5max",
		loadedContextTokens: 131072,
		typicalPromptTokens: 9000,
		peakPromptTokens: 14000,
		avgTtftMs: 6000,
		medianTokensPerSec: 40,
		sampleCount: 40,
		lowPowerMode: true,
		...overrides,
	};
}

describe("recommendContextSizeForObservation", () => {
	it("REDUCE: over-provisioned window + slow prefill ⇒ a cap above peak, never below the 32k floor", () => {
		const rec = recommendContextSizeForObservation(obs());
		expect(rec.kind).toBe("reduce_context");
		expect(rec.suggestedContextTokens).toBeDefined();
		const cap = rec.suggestedContextTokens as number;
		expect(cap).toBeGreaterThanOrEqual(MIN_CONTEXT_FLOOR_TOKENS);
		expect(cap).toBeGreaterThanOrEqual(14000 * 1.5); // ≥ headroom over peak
		expect(cap).toBeLessThan(131072); // an actual reduction
		expect(rec.evidence).toMatch(/unused KV/);
		expect(rec.safetyNotes.length).toBeGreaterThan(0); // never a bare "shrink it"
		expect(rec.safetyNotes.join(" ")).toMatch(/retrieval|compaction|stronger machine/i);
	});

	it("REDUCE cap is CLAMPED to the 32k floor when peak×headroom would fall below it", () => {
		// Tiny usage on a modest-but-above-floor window: peak 1000 × 1.5 = 1500 « floor ⇒ clamp to floor.
		const rec = recommendContextSizeForObservation(
			obs({ loadedContextTokens: 65536, typicalPromptTokens: 800, peakPromptTokens: 1000 }),
		);
		expect(rec.kind).toBe("reduce_context");
		expect(rec.suggestedContextTokens).toBe(MIN_CONTEXT_FLOOR_TOKENS);
	});

	it("KEEP: over-provisioned but prefill is ACCEPTABLE ⇒ no reduce (waste isn't hurting)", () => {
		const rec = recommendContextSizeForObservation(obs({ avgTtftMs: 400 }));
		expect(rec.kind).toBe("keep");
		expect(rec.suggestedContextTokens).toBeUndefined();
	});

	it("KEEP: a well-used window (≥70%) with fast prefill is left alone", () => {
		const rec = recommendContextSizeForObservation(
			obs({ typicalPromptTokens: 100000, peakPromptTokens: 110000, avgTtftMs: 500 }),
		);
		expect(rec.kind).toBe("keep");
		expect(rec.evidence).toMatch(/well used/i);
	});

	it("ROUTE: a well-used window that is SLOW ⇒ route to a stronger machine, never cut", () => {
		const rec = recommendContextSizeForObservation(
			obs({ typicalPromptTokens: 100000, peakPromptTokens: 110000, avgTtftMs: 9000 }),
		);
		expect(rec.kind).toBe("route_to_stronger_machine");
		expect(rec.suggestedContextTokens).toBeUndefined();
		expect(rec.safetyNotes.join(" ")).toMatch(/do not cut/i);
	});

	it("ROUTE: peak usage overflowing the loaded window ⇒ the window is too small, route/raise", () => {
		const rec = recommendContextSizeForObservation(
			obs({ loadedContextTokens: 32768, typicalPromptTokens: 30000, peakPromptTokens: 33000 }),
		);
		expect(rec.kind).toBe("route_to_stronger_machine");
		expect(rec.evidence).toMatch(/bottleneck|meets\/exceeds/i);
	});

	it("KEEP (low confidence): too few samples ⇒ never advises on thin evidence", () => {
		const rec = recommendContextSizeForObservation(obs({ sampleCount: 3 }));
		expect(rec.kind).toBe("keep");
		expect(rec.confidence).toBe("low");
		expect(rec.evidence).toMatch(/too few/i);
	});

	it("KEEP: unknown prompt usage ⇒ cannot judge waste", () => {
		const rec = recommendContextSizeForObservation(obs({ typicalPromptTokens: null, peakPromptTokens: null }));
		expect(rec.kind).toBe("keep");
		expect(rec.evidence).toMatch(/No prompt-token usage/i);
	});

	it("KEEP: a window already at/below the floor is never advised lower", () => {
		const rec = recommendContextSizeForObservation(
			obs({ loadedContextTokens: MIN_CONTEXT_FLOOR_TOKENS, typicalPromptTokens: 2000, peakPromptTokens: 3000 }),
		);
		expect(rec.kind).toBe("keep");
		expect(rec.evidence).toMatch(/floor/i);
	});

	it("KEEP: over-provisioned + slow but the saving is below the minimum worthwhile ratio", () => {
		// loaded 40960, peak 24000 → cap = ceil(36000/8192)*8192 = 40960 = loaded ⇒ 0 savings ⇒ keep.
		const rec = recommendContextSizeForObservation(
			obs({ loadedContextTokens: 40960, typicalPromptTokens: 15000, peakPromptTokens: 24000 }),
		);
		expect(rec.kind).toBe("keep");
	});

	it("confidence scales with sample count", () => {
		expect(recommendContextSizeForObservation(obs({ sampleCount: 40 })).confidence).toBe("high");
		expect(recommendContextSizeForObservation(obs({ sampleCount: 15 })).confidence).toBe("medium");
		expect(recommendContextSizeForObservation(obs({ sampleCount: 6 })).confidence).toBe("low");
	});
});

describe("adviseContextSizes", () => {
	it("orders reduce → route → keep, biggest savings first, with a summary", () => {
		const advice = adviseContextSizes([
			obs({ modelId: "keep-model", typicalPromptTokens: 100000, peakPromptTokens: 110000, avgTtftMs: 400 }),
			obs({
				modelId: "small-reduce",
				loadedContextTokens: 65536,
				typicalPromptTokens: 5000,
				peakPromptTokens: 8000,
			}),
			obs({ modelId: "big-reduce", loadedContextTokens: 262144, typicalPromptTokens: 6000, peakPromptTokens: 9000 }),
			obs({ modelId: "route-model", typicalPromptTokens: 100000, peakPromptTokens: 110000, avgTtftMs: 9000 }),
		]);
		const kinds = advice.recommendations.map((r) => r.kind);
		expect(kinds[0]).toBe("reduce_context");
		expect(kinds[1]).toBe("reduce_context");
		// Biggest savings (the 262k window) comes before the 64k one.
		expect(advice.recommendations[0].modelId).toBe("big-reduce");
		expect(kinds[2]).toBe("route_to_stronger_machine");
		expect(kinds[3]).toBe("keep");
		expect(advice.summary).toMatch(/2 context-cap suggestion/);
		expect(advice.minContextFloorTokens).toBe(MIN_CONTEXT_FLOOR_TOKENS);
	});

	it("handles an empty batch", () => {
		const advice = adviseContextSizes([]);
		expect(advice.recommendations).toEqual([]);
		expect(advice.summary).toMatch(/No model observations/);
	});

	it("respects a custom floor (never suggests below it)", () => {
		const advice = adviseContextSizes(
			[obs({ loadedContextTokens: 131072, typicalPromptTokens: 2000, peakPromptTokens: 3000 })],
			65536,
		);
		expect(advice.recommendations[0].kind).toBe("reduce_context");
		expect(advice.recommendations[0].suggestedContextTokens).toBe(65536);
	});
});

describe("buildContextSizeObservations (lms-ps ↔ perf-aggregate join)", () => {
	const loadedModels = [
		{ modelKey: "qwen/qwen2.5-coder-14b", machineId: "m5max", contextLength: 131072, isEmbedding: false },
		{ modelKey: "text-embedding-nomic", machineId: "m5max", contextLength: 8192, isEmbedding: true }, // skipped
		{ modelKey: "loaded-but-never-run", machineId: "m4mini", contextLength: 65536, isEmbedding: false },
		{ modelKey: "no-context", machineId: "m5max", contextLength: null, isEmbedding: false }, // skipped
	];
	const perfAggregates = [
		{
			scope: "model",
			modelId: "QWEN/QWEN2.5-CODER-14B", // different case ⇒ normalized join still matches
			runs: 25,
			averageTimeToFirstTokenMs: 5000,
			averageInputTokens: 9000,
		},
		{ scope: "overall", modelId: null, runs: 999, averageTimeToFirstTokenMs: 1, averageInputTokens: 1 }, // ignored
	];

	it("joins by normalized model id, skips embeddings + unknown-context, and marks unrun models 0-sample", () => {
		const obs = buildContextSizeObservations({ loadedModels, modelPerfAggregates: perfAggregates });
		expect(obs.map((o) => o.modelId)).toEqual(["qwen/qwen2.5-coder-14b", "loaded-but-never-run"]);
		const coder = obs[0];
		expect(coder.loadedContextTokens).toBe(131072);
		expect(coder.typicalPromptTokens).toBe(9000); // case-insensitive join landed
		expect(coder.avgTtftMs).toBe(5000);
		expect(coder.sampleCount).toBe(25);
		const unrun = obs[1];
		expect(unrun.sampleCount).toBe(0); // no perf ⇒ advisor will say "too few samples"
		expect(unrun.typicalPromptTokens).toBeNull();
	});

	it("feeds adviseContextSizes end-to-end (the joined coder is a reduce candidate)", () => {
		const advice = adviseContextSizes(
			buildContextSizeObservations({ loadedModels, modelPerfAggregates: perfAggregates }),
		);
		const coder = advice.recommendations.find((r) => r.modelId === "qwen/qwen2.5-coder-14b");
		expect(coder?.kind).toBe("reduce_context");
	});
});

describe("formatContextSizeAdvice", () => {
	it("renders reduce/route lines with evidence + notes, and a clean all-right-sized message", () => {
		const advice = adviseContextSizes([
			obs({
				modelId: "waste-model",
				loadedContextTokens: 262144,
				typicalPromptTokens: 6000,
				peakPromptTokens: 9000,
			}),
		]);
		const text = formatContextSizeAdvice(advice);
		expect(text).toMatch(/Context-size advisor:/);
		expect(text).toMatch(/↓ waste-model/);
		expect(text).toMatch(/cap 262,144 → /);
		expect(text).toMatch(/retrieval|compaction/i);

		const clean = formatContextSizeAdvice(adviseContextSizes([obs({ avgTtftMs: 300 })])); // keep case
		expect(clean).toMatch(/right-sized|enough samples/i);
	});
});

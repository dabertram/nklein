import { describe, expect, it } from "vitest";
import {
	type KvCacheParams,
	kvCacheBytes,
	kvCacheSavingsBytes,
	recommendContextLength,
} from "../../../src/core/kv-cache-size";

// Llama-3.1-8B head geometry — the known anchor for verifying the formula.
const LLAMA_31_8B: Omit<KvCacheParams, "contextLength" | "bytesPerParam"> = {
	numLayers: 32,
	numKvHeads: 8,
	headDim: 128,
};

describe("kvCacheBytes", () => {
	it("matches the known Llama-3.1-8B FP16 case at 4096 context (0.5 GiB)", () => {
		const bytes = kvCacheBytes({ ...LLAMA_31_8B, contextLength: 4096, bytesPerParam: 2 });
		expect(bytes).toBe(536_870_912);
		expect(bytes).toBe(0.5 * 1024 ** 3);
	});

	it("matches the known Llama-3.1-8B FP16 case at 32768 context (4 GiB)", () => {
		const bytes = kvCacheBytes({ ...LLAMA_31_8B, contextLength: 32768, bytesPerParam: 2 });
		expect(bytes).toBe(4_294_967_296);
		expect(bytes).toBe(4 * 1024 ** 3);
	});

	it("halves the cache at Q8 (bytesPerParam 1) versus FP16", () => {
		const fp16 = kvCacheBytes({ ...LLAMA_31_8B, contextLength: 32768, bytesPerParam: 2 });
		const q8 = kvCacheBytes({ ...LLAMA_31_8B, contextLength: 32768, bytesPerParam: 1 });
		expect(q8).toBe(fp16 / 2);
		expect(q8).toBe(2_147_483_648);
	});

	it("quarters the cache at Q4 (bytesPerParam 0.5) versus FP16", () => {
		const fp16 = kvCacheBytes({ ...LLAMA_31_8B, contextLength: 32768, bytesPerParam: 2 });
		const q4 = kvCacheBytes({ ...LLAMA_31_8B, contextLength: 32768, bytesPerParam: 0.5 });
		expect(q4).toBe(fp16 / 4);
	});

	it("scales linearly with context length (8x context => 8x bytes)", () => {
		const small = kvCacheBytes({ ...LLAMA_31_8B, contextLength: 4096, bytesPerParam: 2 });
		const big = kvCacheBytes({ ...LLAMA_31_8B, contextLength: 32768, bytesPerParam: 2 });
		expect(big).toBe(small * 8);
	});

	it("returns 0 when any field is non-positive", () => {
		const base: KvCacheParams = { contextLength: 4096, numLayers: 32, numKvHeads: 8, headDim: 128, bytesPerParam: 2 };
		expect(kvCacheBytes({ ...base, contextLength: 0 })).toBe(0);
		expect(kvCacheBytes({ ...base, numLayers: 0 })).toBe(0);
		expect(kvCacheBytes({ ...base, numKvHeads: -1 })).toBe(0);
		expect(kvCacheBytes({ ...base, headDim: 0 })).toBe(0);
		expect(kvCacheBytes({ ...base, bytesPerParam: 0 })).toBe(0);
	});
});

describe("recommendContextLength", () => {
	it("right-sizes a 6000-token task (+25% = 7500) up to the next 1024 multiple (8192)", () => {
		expect(recommendContextLength({ taskNeededTokens: 6000, maxContextLength: 131_072 })).toBe(8192);
	});

	it("caps at maxContextLength when the task needs more than the model can offer", () => {
		expect(recommendContextLength({ taskNeededTokens: 200_000, maxContextLength: 131_072 })).toBe(131_072);
	});

	it("never returns below roundTo for a tiny task", () => {
		expect(recommendContextLength({ taskNeededTokens: 10, maxContextLength: 131_072 })).toBe(1024);
		expect(recommendContextLength({ taskNeededTokens: 0, maxContextLength: 131_072 })).toBe(1024);
	});

	it("honors a custom headroom fraction and roundTo", () => {
		// 4000 * 1.5 = 6000 -> next multiple of 2000 is 6000 exactly.
		expect(
			recommendContextLength({
				taskNeededTokens: 4000,
				maxContextLength: 131_072,
				safetyHeadroomFraction: 0.5,
				roundTo: 2000,
			}),
		).toBe(6000);
	});

	it("clamps the result to maxContextLength even when maxContextLength is below roundTo", () => {
		// Floor is roundTo, but the ceiling (maxContextLength, lifted to at least roundTo) still wins the clamp.
		expect(recommendContextLength({ taskNeededTokens: 5000, maxContextLength: 512 })).toBe(1024);
	});
});

describe("kvCacheSavingsBytes", () => {
	it("reports the VRAM saved by loading at a smaller context instead of the max", () => {
		const saved = kvCacheSavingsBytes({ ...LLAMA_31_8B, bytesPerParam: 2 }, 32768, 4096);
		// 4 GiB (at 32768) - 0.5 GiB (at 4096) = 3.5 GiB.
		expect(saved).toBe(4_294_967_296 - 536_870_912);
		expect(saved).toBe(3.5 * 1024 ** 3);
	});

	it("clamps to 0 when the 'to' context is larger than the 'from' (growing never 'saves')", () => {
		const saved = kvCacheSavingsBytes({ ...LLAMA_31_8B, bytesPerParam: 2 }, 4096, 32768);
		expect(saved).toBe(0);
	});
});

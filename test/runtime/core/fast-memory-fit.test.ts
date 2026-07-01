import { describe, expect, it } from "vitest";
import {
	assessFastMemoryFit,
	computeFastMemoryFootprint,
	DEFAULT_FAST_MEMORY_FRACTION,
	DEFAULT_OVERHEAD_BYTES,
	decideFastMemoryFit,
	kvCacheBudgetBytes,
} from "../../../src/core/fast-memory-fit";
import type { KvCacheParams } from "../../../src/core/kv-cache-size";
import { kvCacheBytes } from "../../../src/core/kv-cache-size";

const GiB = 1024 ** 3;

// Llama-3.1-8B head geometry — the shared anchor used across the KV-cache tests.
const LLAMA_31_8B: Omit<KvCacheParams, "contextLength" | "bytesPerParam"> = {
	numLayers: 32,
	numKvHeads: 8,
	headDim: 128,
};
const kv = (contextLength: number, bytesPerParam = 2): KvCacheParams => ({
	...LLAMA_31_8B,
	contextLength,
	bytesPerParam,
});

describe("computeFastMemoryFootprint", () => {
	it("sums weights + KV-cache-at-context + the default overhead", () => {
		const fp = computeFastMemoryFootprint({ weightsBytes: 8 * GiB, kvCache: kv(32768) });
		// KV at 32768 FP16 = 4 GiB (the known anchor).
		expect(fp.kvCacheBytes).toBe(4 * GiB);
		expect(fp.weightsBytes).toBe(8 * GiB);
		expect(fp.overheadBytes).toBe(DEFAULT_OVERHEAD_BYTES);
		expect(fp.totalBytes).toBe(8 * GiB + 4 * GiB + DEFAULT_OVERHEAD_BYTES);
		expect(fp.totalBytes).toBe(fp.weightsBytes + fp.kvCacheBytes + fp.overheadBytes);
	});

	it("uses kvCacheBytes for the KV term (context length drives it linearly)", () => {
		const small = computeFastMemoryFootprint({ weightsBytes: 8 * GiB, kvCache: kv(4096) });
		const big = computeFastMemoryFootprint({ weightsBytes: 8 * GiB, kvCache: kv(32768) });
		expect(small.kvCacheBytes).toBe(kvCacheBytes(kv(4096)));
		// 8x the context => 8x the KV term (weights + overhead unchanged).
		expect(big.kvCacheBytes).toBe(small.kvCacheBytes * 8);
		expect(big.totalBytes - small.totalBytes).toBe(small.kvCacheBytes * 7);
	});

	it("halves the KV term at Q8 (bytesPerParam 1) versus FP16", () => {
		const fp16 = computeFastMemoryFootprint({ weightsBytes: 8 * GiB, kvCache: kv(32768, 2) });
		const q8 = computeFastMemoryFootprint({ weightsBytes: 8 * GiB, kvCache: kv(32768, 1) });
		expect(q8.kvCacheBytes).toBe(fp16.kvCacheBytes / 2);
		expect(q8.totalBytes).toBeLessThan(fp16.totalBytes);
	});

	it("honors a custom overhead", () => {
		const fp = computeFastMemoryFootprint({ weightsBytes: 8 * GiB, kvCache: kv(4096), overheadBytes: 2 * GiB });
		expect(fp.overheadBytes).toBe(2 * GiB);
		expect(fp.totalBytes).toBe(8 * GiB + kvCacheBytes(kv(4096)) + 2 * GiB);
	});

	it("treats negative / non-finite terms as 0 (never a negative footprint)", () => {
		const fp = computeFastMemoryFootprint({
			weightsBytes: Number.NaN,
			kvCache: kv(-1), // kvCacheBytes returns 0 for non-positive fields
			overheadBytes: -5 * GiB,
		});
		expect(fp.weightsBytes).toBe(0);
		expect(fp.kvCacheBytes).toBe(0);
		expect(fp.overheadBytes).toBe(0);
		expect(fp.totalBytes).toBe(0);
	});
});

describe("decideFastMemoryFit", () => {
	const fastMemoryBytes = 36 * GiB; // e.g. an M-series unified pool

	it("fits a load comfortably under the 75% budget", () => {
		// budget = 27 GiB; footprint 20 GiB fits with 7 GiB to spare.
		const d = decideFastMemoryFit({ footprintBytes: 20 * GiB, fastMemoryBytes });
		expect(d.fits).toBe(true);
		expect(d.budgetBytes).toBe(fastMemoryBytes * DEFAULT_FAST_MEMORY_FRACTION);
		expect(d.marginBytes).toBe(d.budgetBytes - 20 * GiB);
		expect(d.reason).toMatch(/fits|OK/i);
	});

	it("REFUSES a load that spills past the budget (the cliff)", () => {
		// budget = 27 GiB; footprint 30 GiB overshoots by 3 GiB.
		const d = decideFastMemoryFit({ footprintBytes: 30 * GiB, fastMemoryBytes });
		expect(d.fits).toBe(false);
		expect(d.marginBytes).toBeLessThan(0);
		expect(d.reason).toMatch(/spill|exceed|budget/i);
	});

	it("treats the exact budget boundary as a fit (margin 0)", () => {
		const budget = fastMemoryBytes * DEFAULT_FAST_MEMORY_FRACTION;
		const d = decideFastMemoryFit({ footprintBytes: budget, fastMemoryBytes });
		expect(d.fits).toBe(true);
		expect(d.marginBytes).toBe(0);
	});

	it("just over the boundary spills", () => {
		const budget = fastMemoryBytes * DEFAULT_FAST_MEMORY_FRACTION;
		const d = decideFastMemoryFit({ footprintBytes: budget + 1, fastMemoryBytes });
		expect(d.fits).toBe(false);
		expect(d.marginBytes).toBe(-1);
	});

	it("a stricter fraction shrinks the budget and can flip a fit to a spill", () => {
		const footprintBytes = 22 * GiB;
		const loose = decideFastMemoryFit({ footprintBytes, fastMemoryBytes, fastMemoryFraction: 0.75 }); // 27 budget
		const strict = decideFastMemoryFit({ footprintBytes, fastMemoryBytes, fastMemoryFraction: 0.5 }); // 18 budget
		expect(loose.fits).toBe(true);
		expect(strict.fits).toBe(false);
		expect(strict.budgetBytes).toBeLessThan(loose.budgetBytes);
	});

	it("refuses when fast memory is unknown / non-positive (can't prove a fit)", () => {
		expect(decideFastMemoryFit({ footprintBytes: 1 * GiB, fastMemoryBytes: 0 }).fits).toBe(false);
		expect(decideFastMemoryFit({ footprintBytes: 1 * GiB, fastMemoryBytes: Number.NaN }).fits).toBe(false);
		expect(decideFastMemoryFit({ footprintBytes: 1 * GiB, fastMemoryBytes: -8 * GiB }).fits).toBe(false);
	});

	it("refuses a zero / unknown footprint (nothing meaningful to place)", () => {
		const d = decideFastMemoryFit({ footprintBytes: 0, fastMemoryBytes });
		expect(d.fits).toBe(false);
		expect(d.reason).toMatch(/footprint/i);
	});

	it("falls back to the default fraction for a non-finite / non-positive fraction", () => {
		const bad = decideFastMemoryFit({ footprintBytes: 20 * GiB, fastMemoryBytes, fastMemoryFraction: 0 });
		const dflt = decideFastMemoryFit({ footprintBytes: 20 * GiB, fastMemoryBytes });
		expect(bad.budgetBytes).toBe(dflt.budgetBytes);
	});

	it("clamps a >1 fraction to the whole fast memory", () => {
		const d = decideFastMemoryFit({ footprintBytes: 20 * GiB, fastMemoryBytes, fastMemoryFraction: 2 });
		expect(d.budgetBytes).toBe(fastMemoryBytes); // clamped to 1.0
	});
});

describe("assessFastMemoryFit (geometry → verdict)", () => {
	it("matches the two-step footprint + fit path", () => {
		const oneShot = assessFastMemoryFit({ weightsBytes: 8 * GiB, kvCache: kv(32768), fastMemoryBytes: 36 * GiB });
		const footprint = computeFastMemoryFootprint({ weightsBytes: 8 * GiB, kvCache: kv(32768) });
		const twoStep = decideFastMemoryFit({ footprintBytes: footprint.totalBytes, fastMemoryBytes: 36 * GiB });
		expect(oneShot).toEqual(twoStep);
	});

	it("a big context spills on a small pool but the right-sized context fits", () => {
		// 8 GiB weights on a 20 GiB pool (budget 15 GiB). At 131072 ctx the KV term alone is 16 GiB → spill.
		const big = assessFastMemoryFit({ weightsBytes: 8 * GiB, kvCache: kv(131072), fastMemoryBytes: 20 * GiB });
		expect(big.fits).toBe(false);
		// Right-sized to 32768 ctx (KV 4 GiB) → 8 + 4 + 1 overhead = 13 GiB < 15 budget → fits.
		const sized = assessFastMemoryFit({ weightsBytes: 8 * GiB, kvCache: kv(32768), fastMemoryBytes: 20 * GiB });
		expect(sized.fits).toBe(true);
	});

	it("Q8 KV can rescue a load that FP16 KV spills", () => {
		// 8 GiB weights, 65536 ctx on a 20 GiB pool (budget 15 GiB): FP16 KV = 8 GiB → 8+8+1 = 17 > 15 (spill);
		// Q8 KV = 4 GiB → 8+4+1 = 13 < 15 (fits).
		const fp16 = assessFastMemoryFit({ weightsBytes: 8 * GiB, kvCache: kv(65536, 2), fastMemoryBytes: 20 * GiB });
		const q8 = assessFastMemoryFit({ weightsBytes: 8 * GiB, kvCache: kv(65536, 1), fastMemoryBytes: 20 * GiB });
		expect(fp16.fits).toBe(false);
		expect(q8.fits).toBe(true);
	});
});

describe("kvCacheBudgetBytes", () => {
	it("returns the fast-memory budget minus weights and overhead", () => {
		// budget = 0.75 * 36 = 27 GiB; minus 8 weights minus 1 overhead = 18 GiB for KV.
		const budget = kvCacheBudgetBytes({ weightsBytes: 8 * GiB, fastMemoryBytes: 36 * GiB });
		expect(budget).toBe(27 * GiB - 8 * GiB - DEFAULT_OVERHEAD_BYTES);
		expect(budget).toBe(18 * GiB);
	});

	it("is consistent with the fit decision: a footprint using exactly the KV budget fits", () => {
		const kvBudget = kvCacheBudgetBytes({ weightsBytes: 8 * GiB, fastMemoryBytes: 36 * GiB });
		const footprintBytes = 8 * GiB + kvBudget + DEFAULT_OVERHEAD_BYTES;
		const d = decideFastMemoryFit({ footprintBytes, fastMemoryBytes: 36 * GiB });
		expect(d.fits).toBe(true);
		expect(d.marginBytes).toBe(0);
		// One byte more of KV than the budget => spill.
		const over = decideFastMemoryFit({ footprintBytes: footprintBytes + 1, fastMemoryBytes: 36 * GiB });
		expect(over.fits).toBe(false);
	});

	it("returns 0 when weights + overhead already meet/exceed the budget (no room for any KV)", () => {
		// budget = 0.75 * 12 = 9 GiB; weights 9 GiB + 1 overhead already exceeds it.
		expect(kvCacheBudgetBytes({ weightsBytes: 9 * GiB, fastMemoryBytes: 12 * GiB })).toBe(0);
	});

	it("honors a custom fraction and overhead", () => {
		// budget = 0.5 * 40 = 20 GiB; minus 10 weights minus 2 overhead = 8 GiB.
		const budget = kvCacheBudgetBytes({
			weightsBytes: 10 * GiB,
			fastMemoryBytes: 40 * GiB,
			fastMemoryFraction: 0.5,
			overheadBytes: 2 * GiB,
		});
		expect(budget).toBe(8 * GiB);
	});

	it("returns 0 for unknown fast memory", () => {
		expect(kvCacheBudgetBytes({ weightsBytes: 8 * GiB, fastMemoryBytes: 0 })).toBe(0);
	});
});

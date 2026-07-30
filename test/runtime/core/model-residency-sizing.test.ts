import { describe, expect, it } from "vitest";
import {
	estimateModelResidency,
	fitModelResidency,
	type ModelResidencyInput,
} from "../../../src/core/model-residency-sizing";

/**
 * P25.3 — guards for the sizing core that will decide what !Klein downloads.
 *
 * A sizing formula that is merely SELF-CONSISTENT is worthless: it will agree with itself all the way to a
 * swapping host. So the anchor test checks the KV arithmetic against a real model's published architecture
 * (Llama-3-8B: 32 layers, 8 KV heads, head-dim 128, GQA), where the answer is independently known.
 *
 * The other tests are about direction of error. Under-estimating picks a model that swaps — which on this fleet
 * already crashed a node — so every approximation here must fail HIGH, and the tests assert that rather than
 * trusting the comment.
 */

const GIB = 1024 ** 3;

function input(over: Partial<ModelResidencyInput> = {}): ModelResidencyInput {
	return { paramB: 8, weightBitsPerParam: 4, contextTokens: 32_768, ...over };
}

describe("estimateModelResidency", () => {
	it("matches the KV arithmetic for a REAL published architecture (Llama-3-8B at 32k)", () => {
		// KV = 2 × layers × kvHeads × headDim × ctx × bytes
		//    = 2 × 32 × 8 × 128 × 32768 × 2 = 4 GiB exactly. Independently checkable, which is the point.
		const estimate = estimateModelResidency(
			input({ architecture: { layers: 32, kvHeads: 8, headDim: 128 }, kvBitsPerElement: 16 }),
		);
		expect(estimate.basis).toBe("declared_architecture");
		expect(estimate.kvCacheBytes).toBe(4 * GIB);
		// Q4 weights: 8e9 params × 0.5 bytes = 4 GB.
		expect(estimate.weightsBytes).toBe(4e9);
	});

	it("counts the KV cache at ALL — the omission that makes naive sizing dangerous", () => {
		// A weights-only estimate would call this ~4 GB. With a 32k context it is more than double that.
		const withContext = estimateModelResidency(
			input({ contextTokens: 32_768, architecture: { layers: 32, kvHeads: 8, headDim: 128 } }),
		);
		const withoutContext = estimateModelResidency(
			input({ contextTokens: 0, architecture: { layers: 32, kvHeads: 8, headDim: 128 } }),
		);
		expect(withContext.totalBytes).toBeGreaterThan(withoutContext.totalBytes * 2);
	});

	it("flags when the KV cache EXCEEDS the weights — context, not size, is then the cost", () => {
		// !Klein's >=32k floor puts it in exactly this regime, which is why the caveat exists.
		const estimate = estimateModelResidency(
			input({
				paramB: 8,
				weightBitsPerParam: 4,
				contextTokens: 131_072,
				architecture: { layers: 32, kvHeads: 8, headDim: 128 },
			}),
		);
		expect(estimate.kvCacheBytes).toBeGreaterThan(estimate.weightsBytes);
		expect(estimate.caveats.join(" ")).toContain("LARGER than the weights");
		expect(estimate.kvShareOfTotal).toBeGreaterThan(0.5);
	});

	it("OVER-states KV without a declared architecture — the fail-safe direction", () => {
		// The heuristic assumes no GQA. For Llama-3-8B (8 KV heads vs 32 attention heads) that over-states by ~4x.
		// Being wrong HIGH means passing on a model that would have fit; being wrong LOW means a swapping host.
		const declared = estimateModelResidency(input({ architecture: { layers: 32, kvHeads: 8, headDim: 128 } }));
		const heuristic = estimateModelResidency(input());
		expect(heuristic.basis).toBe("anchored_heuristic");
		expect(heuristic.kvCacheBytes).toBeGreaterThan(declared.kvCacheBytes);
		expect(heuristic.caveats.join(" ")).toContain("over-stated");
	});

	it("labels its basis so a guess is never mistaken for a measurement", () => {
		expect(estimateModelResidency(input()).basis).toBe("anchored_heuristic");
		expect(estimateModelResidency(input({ architecture: { layers: 32, kvHeads: 8, headDim: 128 } })).basis).toBe(
			"declared_architecture",
		);
	});

	it("scales weights with quantisation as published", () => {
		const q4 = estimateModelResidency(input({ weightBitsPerParam: 4, contextTokens: 0 }));
		const q8 = estimateModelResidency(input({ weightBitsPerParam: 8, contextTokens: 0 }));
		const f16 = estimateModelResidency(input({ weightBitsPerParam: 16, contextTokens: 0 }));
		expect(q8.weightsBytes).toBe(q4.weightsBytes * 2);
		expect(f16.weightsBytes).toBe(q4.weightsBytes * 4);
	});

	it("halves KV when the runtime quantises the cache", () => {
		const f16 = estimateModelResidency(
			input({ architecture: { layers: 32, kvHeads: 8, headDim: 128 }, kvBitsPerElement: 16 }),
		);
		const q8 = estimateModelResidency(
			input({ architecture: { layers: 32, kvHeads: 8, headDim: 128 }, kvBitsPerElement: 8 }),
		);
		expect(q8.kvCacheBytes).toBe(f16.kvCacheBytes / 2);
	});

	it("does not extrapolate wildly beyond the anchor table", () => {
		// A linear extrapolation off the end produces confidently silly numbers for very large models. The estimate
		// must still grow with size, but sub-linearly rather than absurdly.
		const large = estimateModelResidency(input({ paramB: 400, contextTokens: 8192 }));
		const largest = estimateModelResidency(input({ paramB: 120, contextTokens: 8192 }));
		expect(large.kvCacheBytes).toBeGreaterThan(largest.kvCacheBytes);
		expect(large.kvCacheBytes).toBeLessThan(largest.kvCacheBytes * 10);
	});
});

describe("fitModelResidency", () => {
	const estimate = estimateModelResidency(input({ architecture: { layers: 32, kvHeads: 8, headDim: 128 } }));

	it("reports a comfortable fit with its headroom", () => {
		const fit = fitModelResidency(estimate, 128 * GIB);
		expect(fit.verdict).toBe("fits");
		expect(fit.headroomBytes).toBeGreaterThan(0);
	});

	it("reports EXCEEDS with the shortfall named", () => {
		const fit = fitModelResidency(estimate, 4 * GIB);
		expect(fit.verdict).toBe("exceeds");
		expect(fit.headroomBytes).toBeLessThan(0);
		expect(fit.reason).toContain("over by");
	});

	it("distinguishes TIGHT from FITS rather than folding them together", () => {
		// "It fits" invites loading it. A host with no headroom is the state that swaps under any concurrent work,
		// which is how the m4mini crash happened — so a bare fit must not read as a green light.
		const fit = fitModelResidency(estimate, estimate.totalBytes * 1.05);
		expect(fit.verdict).toBe("tight");
		expect(fit.reason).toContain("no room");
	});

	it("treats a zero budget as exceeded rather than dividing by it", () => {
		expect(fitModelResidency(estimate, 0).verdict).toBe("exceeds");
	});
});

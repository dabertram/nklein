/**
 * P25.3 phase 1 — ESTIMATE WHAT A MODEL WILL ACTUALLY COST IN RAM, before !Klein has it. PURE core.
 *
 * ── WHY THIS IS THE FOUNDATION ──
 * Every later phase of the full-auto model lifecycle (landscape query → download → residency routing) has to
 * answer one question first: *will this model fit on this machine at the context length we actually run?* The
 * existing fit checks reason about models already present and known; a download decision has to be made from a
 * model card alone.
 *
 * ── THE PART EVERY NAIVE ESTIMATE GETS WRONG ──
 * "Parameters × bytes-per-param" sizes the WEIGHTS and stops. At agent context lengths the **KV cache can exceed
 * the weights**, and !Klein's own prime directive puts the floor at ≥32k — squarely in that regime. A sizing rule
 * that ignores KV does not merely under-report: it systematically picks models that fit on paper and then swap,
 * which on this fleet already cost a live crash (the m4mini 14B incident).
 *
 * ── HONESTY ABOUT WHAT IS KNOWN ──
 * KV cost is a property of ARCHITECTURE (layers × kv-heads × head-dim), not of parameter count. When the caller
 * knows the architecture the estimate is close to exact. When it does not, this module does NOT quietly invent
 * one — it uses a coarse anchor table and, critically, **assumes NO grouped-query attention**, which OVER-states
 * KV by the GQA ratio (4-8× on modern models). Over-stating is the fail-safe direction here: the cost of being
 * wrong high is passing on a model that would have fit; the cost of being wrong low is a swapping host. Every
 * estimate carries its `basis` and its caveats so a caller cannot mistake the two.
 */

export type ResidencyEstimateBasis = "declared_architecture" | "anchored_heuristic";

export interface ModelArchitecture {
	readonly layers: number;
	/** Key/value heads. With GQA this is far smaller than the attention-head count — and it is what KV scales on. */
	readonly kvHeads: number;
	readonly headDim: number;
}

export interface ModelResidencyInput {
	/** Parameter count in BILLIONS, as model cards state it. */
	readonly paramB: number;
	/** Bits per weight after quantisation: 4 for Q4_K_M, 8 for Q8, 16 for f16. */
	readonly weightBitsPerParam: number;
	/** The context length the model will actually be SERVED at — not the maximum it advertises. */
	readonly contextTokens: number;
	/** Exact when known; omitted falls back to the anchor table with a stated caveat. */
	readonly architecture?: ModelArchitecture;
	/** Bits per KV element. 16 (f16) unless the runtime quantises the cache (llama.cpp `--cache-type-k/v`). */
	readonly kvBitsPerElement?: number;
}

export interface ModelResidencyEstimate {
	readonly weightsBytes: number;
	readonly kvCacheBytes: number;
	/** Activations, runtime buffers, allocator slack. A proportional allowance, not a measurement. */
	readonly overheadBytes: number;
	readonly totalBytes: number;
	/** KV as a share of the total — the number that shows when context, not size, is the real cost. */
	readonly kvShareOfTotal: number;
	readonly basis: ResidencyEstimateBasis;
	readonly caveats: readonly string[];
}

export type ResidencyFitVerdict = "fits" | "tight" | "exceeds";

export interface ResidencyFit {
	readonly verdict: ResidencyFitVerdict;
	readonly budgetBytes: number;
	readonly estimate: ModelResidencyEstimate;
	readonly headroomBytes: number;
	readonly reason: string;
}

const BYTES_PER_GIB = 1024 ** 3;
/** Runtime overhead as a fraction of weights+KV. The widely-used rule of thumb is ~20%. */
const OVERHEAD_RATIO = 0.2;
/** Below this headroom fraction a fit is real but has no room for growth — reported as `tight`, never as `fits`. */
const TIGHT_HEADROOM_RATIO = 0.1;

/**
 * Coarse (layers, hidden) anchors by parameter count, used ONLY when the caller cannot supply an architecture.
 *
 * These are representative of mainstream dense transformers, interpolated between anchors. They are a shape
 * approximation, not a claim about any specific model — which is exactly why an estimate built on them is labelled
 * `anchored_heuristic` and carries a caveat.
 */
const ARCHITECTURE_ANCHORS: readonly { paramB: number; layers: number; hidden: number }[] = [
	{ paramB: 1, layers: 22, hidden: 2048 },
	{ paramB: 3, layers: 28, hidden: 3072 },
	{ paramB: 8, layers: 32, hidden: 4096 },
	{ paramB: 14, layers: 48, hidden: 5120 },
	{ paramB: 32, layers: 64, hidden: 5120 },
	{ paramB: 70, layers: 80, hidden: 8192 },
	{ paramB: 120, layers: 96, hidden: 12288 },
];

function interpolateAnchor(paramB: number): { layers: number; hidden: number } {
	const first = ARCHITECTURE_ANCHORS[0] as { paramB: number; layers: number; hidden: number };
	const last = ARCHITECTURE_ANCHORS[ARCHITECTURE_ANCHORS.length - 1] as {
		paramB: number;
		layers: number;
		hidden: number;
	};
	if (paramB <= first.paramB) {
		return { layers: first.layers, hidden: first.hidden };
	}
	if (paramB >= last.paramB) {
		// Beyond the table, scale the largest anchor rather than extrapolating a slope — a linear extrapolation
		// off the end produces confidently silly numbers for a 400B model.
		const scale = paramB / last.paramB;
		return { layers: Math.round(last.layers * scale ** 0.5), hidden: Math.round(last.hidden * scale ** 0.5) };
	}
	for (let index = 1; index < ARCHITECTURE_ANCHORS.length; index += 1) {
		const low = ARCHITECTURE_ANCHORS[index - 1] as { paramB: number; layers: number; hidden: number };
		const high = ARCHITECTURE_ANCHORS[index] as { paramB: number; layers: number; hidden: number };
		if (paramB <= high.paramB) {
			const t = (paramB - low.paramB) / (high.paramB - low.paramB);
			return {
				layers: Math.round(low.layers + t * (high.layers - low.layers)),
				hidden: Math.round(low.hidden + t * (high.hidden - low.hidden)),
			};
		}
	}
	return { layers: last.layers, hidden: last.hidden };
}

/**
 * Estimate resident memory for a model at a given context length.
 *
 * KV cache = 2 (K and V) × layers × kvHeads × headDim × contextTokens × bytesPerElement — the standard formula.
 * Without a declared architecture, `kvHeads × headDim` is taken as the full hidden size, i.e. **no GQA**, which
 * over-states KV by the grouping ratio on any model that uses it.
 */
export function estimateModelResidency(input: ModelResidencyInput): ModelResidencyEstimate {
	const caveats: string[] = [];
	const paramB = Math.max(0, input.paramB);
	const contextTokens = Math.max(0, input.contextTokens);
	const kvBits = input.kvBitsPerElement ?? 16;

	const weightsBytes = paramB * 1e9 * (input.weightBitsPerParam / 8);

	let kvElementsPerToken: number;
	let basis: ResidencyEstimateBasis;
	if (input.architecture) {
		basis = "declared_architecture";
		kvElementsPerToken = 2 * input.architecture.layers * input.architecture.kvHeads * input.architecture.headDim;
	} else {
		basis = "anchored_heuristic";
		const anchor = interpolateAnchor(paramB);
		// hidden === kvHeads × headDim only WITHOUT grouped-query attention. Deliberate: assuming no GQA
		// over-states KV, and over-stating means passing on a model that would have fit rather than choosing one
		// that swaps.
		kvElementsPerToken = 2 * anchor.layers * anchor.hidden;
		caveats.push(
			"architecture not declared: layers/hidden interpolated from a coarse anchor table, and NO grouped-query attention assumed — KV is over-stated (typically 4-8x) for any model that uses GQA",
		);
	}

	const kvCacheBytes = kvElementsPerToken * contextTokens * (kvBits / 8);
	const overheadBytes = (weightsBytes + kvCacheBytes) * OVERHEAD_RATIO;
	const totalBytes = weightsBytes + kvCacheBytes + overheadBytes;

	if (kvCacheBytes > weightsBytes) {
		caveats.push(
			"the KV cache is LARGER than the weights at this context length — context, not parameter count, is the binding cost here",
		);
	}
	if (input.kvBitsPerElement === undefined) {
		caveats.push(
			"assumed an f16 KV cache; a runtime quantising the cache (e.g. llama.cpp --cache-type-k/v) uses less",
		);
	}

	return {
		weightsBytes,
		kvCacheBytes,
		overheadBytes,
		totalBytes,
		kvShareOfTotal: totalBytes > 0 ? kvCacheBytes / totalBytes : 0,
		basis,
		caveats,
	};
}

/** Judge an estimate against a declared budget. `tight` is a distinct verdict, never folded into `fits`. */
export function fitModelResidency(estimate: ModelResidencyEstimate, budgetBytes: number): ResidencyFit {
	const headroomBytes = budgetBytes - estimate.totalBytes;
	const toGib = (bytes: number) => (bytes / BYTES_PER_GIB).toFixed(1);
	if (headroomBytes < 0) {
		return {
			verdict: "exceeds",
			budgetBytes,
			estimate,
			headroomBytes,
			reason: `needs ~${toGib(estimate.totalBytes)} GiB against a ${toGib(budgetBytes)} GiB budget — over by ${toGib(-headroomBytes)} GiB`,
		};
	}
	if (budgetBytes > 0 && headroomBytes / budgetBytes < TIGHT_HEADROOM_RATIO) {
		// Reported separately because "it fits" invites loading it, and a host with no headroom is the state that
		// swaps under any concurrent work — which on this fleet has already crashed a node.
		return {
			verdict: "tight",
			budgetBytes,
			estimate,
			headroomBytes,
			reason: `fits with only ~${toGib(headroomBytes)} GiB spare of ${toGib(budgetBytes)} GiB — no room for a second model or a longer context`,
		};
	}
	return {
		verdict: "fits",
		budgetBytes,
		estimate,
		headroomBytes,
		reason: `needs ~${toGib(estimate.totalBytes)} GiB, leaving ~${toGib(headroomBytes)} GiB of ${toGib(budgetBytes)} GiB`,
	};
}

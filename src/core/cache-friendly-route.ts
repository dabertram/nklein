/**
 * Cache-friendly variant routing (todo §5.AQ item E — the adaptation playbook). When the SAME model is available in
 * multiple engine/format builds, prefer the one whose prefix-cache actually works.
 *
 * The key operational lesson (LM Studio #1697 / mlx-lm #980): for a HYBRID-attention architecture (SWA / SSM-Mamba /
 * mixed — GPT-OSS, Qwen3.5, Gemma3, …) the MLX build silently disables prefix caching (full re-prefill every turn) while
 * the GGUF build of the SAME model caches fine. The architecture (from the model id) is identical across builds, so the
 * differentiator is the ENGINE/FORMAT, not the architecture: route hybrids to GGUF. For pure full-attention models every
 * build caches, so the first/preferred variant is kept. Pure; the live TTFT probe (cache-health.ts) confirms the choice.
 */

import { classifyAttentionArchitecture, isLikelyCacheFriendly } from "./cache-friendly-arch";

/** One available build of a model: the same `modelId` may have several (different engine/format). */
export interface ModelVariant {
	modelId: string;
	/** e.g. "llama.cpp" | "mlx" — the inference engine. */
	engine?: string;
	/** e.g. "gguf" | "mlx" — the weight format. */
	format?: string;
}

export interface CacheFriendlyRouteResult {
	chosen: ModelVariant | null;
	reason: string;
}

function isGgufVariant(v: ModelVariant): boolean {
	return (v.format ?? "").toLowerCase().includes("gguf") || (v.engine ?? "").toLowerCase().includes("llama");
}

function isMlxVariant(v: ModelVariant): boolean {
	return (v.format ?? "").toLowerCase().includes("mlx") || (v.engine ?? "").toLowerCase().includes("mlx");
}

/**
 * Pick the cache-friendliest variant. For a hybrid-attention model, prefer a GGUF/llama.cpp build over an MLX build
 * (MLX prefix-caching is broken for hybrids); if no GGUF build exists, keep the first variant but flag it. For a
 * full-attention model (every build caches), keep the first variant. Empty input → null.
 */
export function selectCacheFriendlyVariant(input: { variants: readonly ModelVariant[] }): CacheFriendlyRouteResult {
	const variants = input.variants;
	const first = variants[0];
	if (first === undefined) {
		return { chosen: null, reason: "no variants" };
	}

	// Architecture is keyed on the model id, identical across builds of the same model — use the first.
	const arch = classifyAttentionArchitecture({ modelId: first.modelId });
	if (isLikelyCacheFriendly(arch)) {
		return { chosen: first, reason: `${arch}: every build caches — keeping the first variant` };
	}

	// Hybrid/unknown: MLX likely breaks prefix caching → prefer a GGUF/llama.cpp build.
	const gguf = variants.find(isGgufVariant);
	if (gguf) {
		return { chosen: gguf, reason: `${arch}: routed to a GGUF build (MLX prefix-caching is broken for hybrids)` };
	}
	const nonMlx = variants.find((v) => !isMlxVariant(v));
	if (nonMlx) {
		return { chosen: nonMlx, reason: `${arch}: no GGUF build — kept a non-MLX variant` };
	}
	return {
		chosen: first,
		reason: `${arch}: only MLX builds available — prefix caching may be broken; probe to confirm`,
	};
}

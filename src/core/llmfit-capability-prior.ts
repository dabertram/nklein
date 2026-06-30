/**
 * llmfit → cold-start capability PRIOR (todo §5.AB, user 2026-07-01: "llmfit will help to have a baseline for model
 * capabilities"). The router can't tell a coder from a reasoner at cold-start because every unobserved model gets the
 * same flat prior; llmfit's `fit --json` scores ~4700 models (0–100 quality×speed×fit + a `category` like `Coding`), so
 * it's the ready-made baseline. The only friction is matching a LOADED model id (`qwen2.5-coder-14b`) to llmfit's HF name
 * (`Qwen/Qwen2.5-Coder-14B-Instruct`) — handled here by normalizing both (drop org prefix, quant/format/variant tokens).
 *
 * Pure (given the parsed llmfit models), so the matcher + prior are unit-testable without invoking llmfit.
 */

import type { LlmfitModel } from "./llmfit-adapter";

/** Variant/quant/format tokens to strip when normalizing a model name for matching (whole hyphen/dot segments). */
const STRIP_SEGMENTS =
	/\b(instruct|it|chat|base|gguf|mlx|awq|gptq|bf16|fp16|fp8|f16|\d+bit|i?q\d[\w.]*|k[ms]|kxl|xl|mtp|hf)\b/g;

/**
 * Normalize a model name/id for fuzzy matching: lowercase, drop the org prefix (`org/…`), drop an `@quant` suffix, strip
 * known quant/format/variant segments, and collapse separators. e.g. both `qwen2.5-coder-14b` and
 * `Qwen/Qwen2.5-Coder-14B-Instruct` → `qwen2.5-coder-14b`.
 */
export function normalizeModelNameForMatch(name: string): string {
	let s = name.toLowerCase().trim();
	const slash = s.lastIndexOf("/");
	if (slash >= 0) {
		s = s.slice(slash + 1);
	}
	s = s.replace(/@.*$/, ""); // drop @quant (LM Studio instance suffix)
	s = s.replace(STRIP_SEGMENTS, "");
	return s.replace(/[^a-z0-9.]+/g, "-").replace(/^-+|-+$/g, "");
}

/**
 * Find the llmfit model best matching a loaded model id: an exact normalized match wins; otherwise a containment match
 * (one normalized name contains the other, ≥6 chars to avoid spurious hits). Returns null when nothing plausibly matches
 * (e.g. a locally-renamed/custom model llmfit's DB doesn't know — the caller then falls back to the §5.AL catalog/default).
 */
export function findLlmfitMatch(loadedModelId: string, models: readonly LlmfitModel[]): LlmfitModel | null {
	const target = normalizeModelNameForMatch(loadedModelId);
	if (target.length < 3) {
		return null;
	}
	let contained: LlmfitModel | null = null;
	for (const model of models) {
		const normalized = normalizeModelNameForMatch(model.name);
		if (normalized === target) {
			return model;
		}
		if (
			!contained &&
			Math.min(normalized.length, target.length) >= 6 &&
			(normalized.includes(target) || target.includes(normalized))
		) {
			contained = model;
		}
	}
	return contained;
}

/**
 * The cold-start capability prior + category for a loaded model from llmfit's scored DB, or null when llmfit doesn't
 * know it (or scored it null). `score` is llmfit's 0–100 quality×speed×fit — directly usable as a routing capability prior
 * (same scale as the registry's `DEFAULT_CAPABILITY_PRIOR`); `category` (e.g. `Coding`) is a skill-match signal.
 */
export function llmfitCapabilityPrior(
	loadedModelId: string,
	models: readonly LlmfitModel[],
): { score: number; category: string | null } | null {
	const match = findLlmfitMatch(loadedModelId, models);
	return match && match.score !== null ? { score: match.score, category: match.category } : null;
}

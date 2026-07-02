import { normalizeModelId } from "./model-identity.js";

/**
 * §5.AB reasoning-diversity (audit 2026-07-02 W0.3): the COARSE model lineage — the training/architecture family
 * whose shared blind spots make two models' judgments CORRELATED. Family-diverse DECISION roles (architect ≠
 * reviewer/verifier lineage) are what make a second opinion worth its compute (same-family models agree on wrong
 * answers ~60% of the time — see docs/dev/research-2026-07-02.md); workers are selected on pure fit (generation
 * quality does NOT benefit from forced diversity — Self-MoA).
 *
 * Deliberately COARSER than the capability catalog's per-entry `family` slug (phi-4-mini vs phi-4-reasoning are
 * different slugs, ONE lineage). DECIDED 2026-07-02: all qwen3_x variants (qwen / qwopus / qwq / ornith) are ONE
 * `qwen` lineage — a qwen-only fleet can therefore never be decision-diverse, and that is surfaced, not hidden.
 * R1-style distills count as `deepseek` (the reasoning training dominates the blind-spot profile, not the base arch).
 *
 * NOTE: match against the REAL model id/key (the loaded-model descriptor's key), not a per-machine alias — a custom
 * LM Studio identifier like `coder-gpu` resolves to `unknown` (which is treated as NON-diverse-safe).
 */
export type ModelLineage =
	| "gpt-oss"
	| "qwen"
	| "phi"
	| "gemma"
	| "mistral"
	| "nemotron"
	| "llama"
	| "deepseek"
	| "unknown";

/** Ordered (first hit wins): specific trainings before base-arch matches — e.g. an R1 distill of qwen ⇒ deepseek. */
const LINEAGE_MATCHERS: readonly { lineage: Exclude<ModelLineage, "unknown">; match: RegExp }[] = [
	{ lineage: "deepseek", match: /deepseek|r1[-_]?distill/ },
	{ lineage: "gpt-oss", match: /gpt[-_]?oss/ },
	{ lineage: "nemotron", match: /nemotron/ },
	{ lineage: "qwen", match: /qwen|qwopus|qwq|ornith/ },
	{ lineage: "phi", match: /phi[-_]?[0-9]/ },
	{ lineage: "gemma", match: /gemma/ },
	{ lineage: "mistral", match: /mistral|mixtral|magistral|devstral/ },
	{ lineage: "llama", match: /llama/ },
];

/** Resolve a model id to its coarse lineage (pure; `unknown` when nothing matches — e.g. a per-machine alias). */
export function resolveLineage(modelId: string): ModelLineage {
	const normalized = normalizeModelId(modelId).toLowerCase();
	for (const { lineage, match } of LINEAGE_MATCHERS) {
		if (match.test(normalized)) {
			return lineage;
		}
	}
	return "unknown";
}

/** Do two models share a KNOWN lineage? (`unknown` never "shares" — but see {@link isLineageDiverse} for gating.) */
export function modelsShareLineage(a: string, b: string): boolean {
	const lineageA = resolveLineage(a);
	return lineageA !== "unknown" && lineageA === resolveLineage(b);
}

/**
 * Is pairing these two models a GUARANTEED-diverse decision pair? Conservative: true only when BOTH lineages are
 * known AND different — an `unknown` model can never be counted as providing a diverse second opinion (it might be
 * a same-family alias), so it fails the guarantee rather than silently passing.
 */
export function isLineageDiverse(a: string, b: string): boolean {
	const lineageA = resolveLineage(a);
	const lineageB = resolveLineage(b);
	return lineageA !== "unknown" && lineageB !== "unknown" && lineageA !== lineageB;
}

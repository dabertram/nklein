import type { LoadedModelDescriptor } from "./lmstudio-loaded-model-descriptors";
import { lookupModelCapability } from "./model-capability-catalog";
import { type ModelLineage, resolveLineage } from "./model-lineage";

/**
 * §5.AL / §5.AB gap 5 (David 2026-07-07) — user-facing MODEL SUGGESTIONS. Given the currently-LOADED fleet, advise
 * what to FETCH/enable to strengthen it — the highest-value, hardware-independent checks that directly serve the
 * §5.AB reasoning-diversity + depth principles:
 *
 *  1. **Decision-layer monoculture** — if every loaded model shares ONE base lineage (or none is recognized), reviews
 *     and escalations can't get an UNCORRELATED second opinion (same-family models share blind spots ~60%). Suggest
 *     adding a DIFFERENT-base-family model. Family = BASE lineage (a Qwen fine-tune is Qwen), never the display label.
 *  2. **No reasoning depth** — if no loaded model is a reasoning/agentic KIND, the architect/judge roles have no deep
 *     reasoner (planning + review are reasoning-led). Suggest loading one (workers can stay code-tuned).
 *  3. **No agentic model at all** — only embeddings (or nothing) loaded ⇒ !Klein can't run tasks.
 *
 * Pure (loaded descriptors + the lineage resolver + the catalog lookup, which is itself overlay-aware) so it is
 * unit-testable without a live endpoint. Advice names model FAMILIES (a diversity taxonomy), never specific SKUs —
 * consistent with the data-driven catalog (decision #1): no volatile model names baked into logic.
 */

export type ModelFleetSuggestionKind = "no_agentic_model" | "add_diverse_family" | "add_reasoning_model";

export interface ModelFleetSuggestion {
	kind: ModelFleetSuggestionKind;
	severity: "info" | "warn";
	title: string;
	detail: string;
}

/** Human labels for the coarse lineages (base families) surfaced in advice. */
const FAMILY_LABEL: Record<Exclude<ModelLineage, "unknown">, string> = {
	"gpt-oss": "gpt-oss",
	qwen: "Qwen",
	phi: "Phi",
	gemma: "Gemma",
	mistral: "Mistral/Devstral",
	nemotron: "Nemotron",
	llama: "Llama",
	deepseek: "DeepSeek",
};

/** Families that tend to make good UNCORRELATED reviewers, in rough preference order — used to name absent options. */
const REVIEWER_FAMILY_PREFERENCE: readonly Exclude<ModelLineage, "unknown">[] = [
	"mistral",
	"gemma",
	"gpt-oss",
	"deepseek",
	"qwen",
	"phi",
	"llama",
	"nemotron",
];

/**
 * Advise what to add to the loaded fleet. Returns an ordered list (most-important first) or `[]` when the fleet is
 * already diverse + has reasoning depth. Pure.
 */
export function adviseModelFleet(descriptors: readonly LoadedModelDescriptor[]): ModelFleetSuggestion[] {
	const agentic = descriptors.filter((descriptor) => !descriptor.isEmbedding);
	if (agentic.length === 0) {
		return [
			{
				kind: "no_agentic_model",
				severity: "warn",
				title: "No agentic model loaded",
				detail:
					"Only embedding models (or none) are loaded — !Klein can't run tasks. Load a tool-capable model (a coder/agentic model) to start.",
			},
		];
	}

	const suggestions: ModelFleetSuggestion[] = [];

	// (1) Decision-layer diversity: distinct KNOWN base lineages. 0 or 1 ⇒ no uncorrelated reviewer is possible.
	const lineages = new Set<Exclude<ModelLineage, "unknown">>();
	for (const descriptor of agentic) {
		const lineage = resolveLineage(descriptor.modelKey);
		if (lineage !== "unknown") {
			lineages.add(lineage);
		}
	}
	if (lineages.size <= 1) {
		const present = [...lineages];
		const presentLabel = present.length === 1 ? FAMILY_LABEL[present[0]] : "a single / unrecognized";
		const absent = REVIEWER_FAMILY_PREFERENCE.filter((family) => !lineages.has(family))
			.slice(0, 3)
			.map((family) => FAMILY_LABEL[family]);
		suggestions.push({
			kind: "add_diverse_family",
			severity: "warn",
			title: "Decision layer is a single-family monoculture",
			detail:
				`Your loaded models share one base family (${presentLabel}) — same-family models share blind spots ` +
				`(~60% correlated failures), so reviews and escalations can't get an uncorrelated second opinion. Add a ` +
				`model from a DIFFERENT base family (e.g. ${absent.join(", ")}) to strengthen review + escalation diversity.`,
		});
	}

	// (2) Reasoning depth for the architect/judge role — planning + review are reasoning-led.
	const hasReasoner = agentic.some((descriptor) => {
		const kind = lookupModelCapability(descriptor.modelKey)?.kind;
		return kind === "reasoning" || kind === "agentic";
	});
	if (!hasReasoner) {
		suggestions.push({
			kind: "add_reasoning_model",
			severity: "info",
			title: "No strong reasoner for the judge/architect role",
			detail:
				"None of the loaded models is a reasoning/agentic kind — planning and review are reasoning-led, so the " +
				"architect and judge roles have no deep reasoner. Load a reasoning-class model for those roles (workers can " +
				"stay code-tuned).",
		});
	}

	return suggestions;
}

import type { LoadedModelDescriptor } from "./lmstudio-loaded-model-descriptors";
import {
	lookupModelCapability,
	type ModelCapabilityEntry,
	type ModelKind,
	type ToolUseVerdict,
} from "./model-capability-catalog";
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

export interface ModelFleetAdviceOptions {
	/** Optional catalog snapshot, usually overlay + shipped catalog + cached llmfit supplement. No network work here. */
	recommendationCatalog?: readonly ModelCapabilityEntry[];
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

const REVIEWER_FAMILY_RANK = new Map(REVIEWER_FAMILY_PREFERENCE.map((family, index) => [family, index]));

const TOOL_USE_RANK: Record<ToolUseVerdict, number> = {
	TOOL_NATIVE: 0,
	TOOL_CAPABLE: 1,
	TOOL_WEAK: 2,
	UNKNOWN: 3,
	TOOL_UNSUITABLE: 4,
};

const KIND_RANK: Record<ModelKind, number> = {
	agentic: 0,
	reasoning: 1,
	code: 2,
	instruct: 3,
	chat: 4,
	roleplay: 5,
	unknown: 6,
};

type RecommendationPurpose = "starter" | "diverse_family" | "reasoning_depth";

function isFetchRecommendationCandidate(entry: ModelCapabilityEntry): boolean {
	const isLlmfitSupplement = entry.family.startsWith("llmfit:");
	return (
		entry.severityOverride !== "reject" &&
		(entry.verified !== false || isLlmfitSupplement) &&
		(entry.toolUse === "TOOL_NATIVE" ||
			entry.toolUse === "TOOL_CAPABLE" ||
			(isLlmfitSupplement && entry.toolUse === "UNKNOWN"))
	);
}

function formatCatalogFamilyLabel(family: string): string {
	return family.replace(/^llmfit:/, "");
}

function selectCatalogRecommendations(
	catalog: readonly ModelCapabilityEntry[] | undefined,
	input: {
		purpose: RecommendationPurpose;
		presentLineages?: ReadonlySet<Exclude<ModelLineage, "unknown">>;
		limit?: number;
	},
): string[] {
	const presentLineages = input.presentLineages ?? new Set<Exclude<ModelLineage, "unknown">>();
	const candidates = (catalog ?? [])
		.filter(isFetchRecommendationCandidate)
		.map((entry) => ({ entry, lineage: resolveLineage(entry.family) }))
		.filter(({ entry, lineage }) => {
			if (input.purpose === "diverse_family") {
				return lineage !== "unknown" && !presentLineages.has(lineage);
			}
			if (input.purpose === "reasoning_depth") {
				return entry.kind === "agentic" || entry.kind === "reasoning";
			}
			return true;
		})
		.sort((left, right) => {
			const leftFamilyRank = left.lineage === "unknown" ? 99 : (REVIEWER_FAMILY_RANK.get(left.lineage) ?? 50);
			const rightFamilyRank = right.lineage === "unknown" ? 99 : (REVIEWER_FAMILY_RANK.get(right.lineage) ?? 50);
			return (
				leftFamilyRank - rightFamilyRank ||
				TOOL_USE_RANK[left.entry.toolUse] - TOOL_USE_RANK[right.entry.toolUse] ||
				KIND_RANK[left.entry.kind] - KIND_RANK[right.entry.kind] ||
				left.entry.family.localeCompare(right.entry.family)
			);
		});

	const seenFamilies = new Set<string>();
	const seenLineages = new Set<ModelLineage>();
	const result: string[] = [];
	for (const { entry, lineage } of candidates) {
		const family = entry.family.trim();
		if (!family || seenFamilies.has(family)) {
			continue;
		}
		if (input.purpose === "diverse_family" && lineage !== "unknown" && seenLineages.has(lineage)) {
			continue;
		}
		seenFamilies.add(family);
		seenLineages.add(lineage);
		result.push(formatCatalogFamilyLabel(family));
		if (result.length >= (input.limit ?? 3)) {
			break;
		}
	}
	return result;
}

function catalogRecommendationSentence(recommendations: readonly string[]): string {
	if (recommendations.length === 0) {
		return "";
	}
	return ` Catalog-backed candidates to fetch/check: ${recommendations.join(", ")}.`;
}

/**
 * Advise what to add to the loaded fleet. Returns an ordered list (most-important first) or `[]` when the fleet is
 * already diverse + has reasoning depth. Pure.
 */
export function adviseModelFleet(
	descriptors: readonly LoadedModelDescriptor[],
	options: ModelFleetAdviceOptions = {},
): ModelFleetSuggestion[] {
	const agentic = descriptors.filter((descriptor) => !descriptor.isEmbedding);
	if (agentic.length === 0) {
		const starterRecommendations = selectCatalogRecommendations(options.recommendationCatalog, {
			purpose: "starter",
		});
		return [
			{
				kind: "no_agentic_model",
				severity: "warn",
				title: "No agentic model loaded",
				detail:
					"Only embedding models (or none) are loaded — !Klein can't run tasks. Load a tool-capable model (a coder/agentic model) to start." +
					catalogRecommendationSentence(starterRecommendations),
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
		const diverseRecommendations = selectCatalogRecommendations(options.recommendationCatalog, {
			purpose: "diverse_family",
			presentLineages: lineages,
		});
		suggestions.push({
			kind: "add_diverse_family",
			severity: "warn",
			title: "Decision layer is a single-family monoculture",
			detail:
				`Your loaded models share one base family (${presentLabel}) — same-family models share blind spots ` +
				`(~60% correlated failures), so reviews and escalations can't get an uncorrelated second opinion. Add a ` +
				`model from a DIFFERENT base family (e.g. ${absent.join(", ")}) to strengthen review + escalation diversity.` +
				catalogRecommendationSentence(diverseRecommendations),
		});
	}

	// (2) Reasoning depth for the architect/judge role — planning + review are reasoning-led.
	const hasReasoner = agentic.some((descriptor) => {
		const kind = lookupModelCapability(descriptor.modelKey)?.kind;
		return kind === "reasoning" || kind === "agentic";
	});
	if (!hasReasoner) {
		const reasoningRecommendations = selectCatalogRecommendations(options.recommendationCatalog, {
			purpose: "reasoning_depth",
			presentLineages: lineages,
		});
		suggestions.push({
			kind: "add_reasoning_model",
			severity: "info",
			title: "No strong reasoner for the judge/architect role",
			detail:
				"None of the loaded models is a reasoning/agentic kind — planning and review are reasoning-led, so the " +
				"architect and judge roles have no deep reasoner. Load a reasoning-class model for those roles (workers can " +
				"stay code-tuned)." +
				catalogRecommendationSentence(reasoningRecommendations),
		});
	}

	return suggestions;
}

import { assessClarificationNeed } from "../core/clarification-need";
import type { LoadedModelDescriptor } from "../core/lmstudio-loaded-model-descriptors";
import { resolveLineage } from "../core/model-lineage";
import { reasoningAndAnswerText } from "../core/reasoning-channel-split";
import {
	buildDeliberationPrompt,
	combineDeliberation,
	DELIBERATION_STANCES,
	type DeliberationMode,
	type DeliberationResult,
	decideDeliberationStaffing,
	parseDeliberationReply,
} from "../core/spec-deliberation";
import { lintSpecForDecompose } from "../core/spec-lint";

const MIN_CONTEXT_TOKENS = 32_768;

export interface SpecDeliberationModel {
	readonly providerId: string;
	readonly modelId: string;
	readonly modelKey: string;
	readonly baseUrl: string;
	readonly apiKey?: string | null;
	readonly timeoutMs?: number | null;
	readonly contextWindow: number;
	readonly family: string;
}

export interface SpecDeliberationRunResult {
	readonly mode: Exclude<DeliberationMode, "skipped">;
	readonly staffingReason: string;
	readonly deliberation: DeliberationResult;
	readonly completedModelIds: readonly string[];
	readonly guidance: readonly string[];
}

/**
 * Read the structured reply from either OpenAI's ordinary content channel or a reasoning-only local template.
 * The caller persists only parsed ambiguities, never this transient text.
 */
export function readSpecDeliberationCompletionText(completion: {
	readonly content: string;
	readonly raw: unknown;
}): string | null {
	if (completion.content.trim()) return completion.content;
	const raw = completion.raw as {
		choices?: Array<{ message?: { content?: string | null; reasoning_content?: string | null } }>;
	};
	return reasoningAndAnswerText(raw.choices?.[0]?.message ?? {}) || null;
}

function familyFor(modelKey: string): string {
	return resolveLineage(modelKey);
}

function descriptorScore(descriptor: LoadedModelDescriptor): number {
	return (
		(descriptor.reasoning === true ? 4 : 0) +
		(descriptor.toolUse === true ? 2 : 0) +
		(descriptor.vision === true ? 0 : 1) +
		Math.log2(Math.max(1, descriptor.sizeBytes ?? 1)) / 100
	);
}

/** Choose at most one currently-served >=32k model per known family, keeping the routed worker first. */
export function selectSpecDeliberationModels(input: {
	readonly primary: Omit<SpecDeliberationModel, "family" | "modelKey"> & { readonly modelKey?: string | null };
	readonly loaded: readonly LoadedModelDescriptor[];
}): SpecDeliberationModel[] {
	if (input.primary.contextWindow < MIN_CONTEXT_TOKENS) return [];
	const primaryDescriptor = input.loaded.find((descriptor) => descriptor.runtimeId === input.primary.modelId);
	const primaryKey = input.primary.modelKey?.trim() || primaryDescriptor?.modelKey || input.primary.modelId;
	const primary: SpecDeliberationModel = {
		...input.primary,
		modelKey: primaryKey,
		family: familyFor(primaryKey),
	};
	const chosen = [primary];
	const usedFamilies = new Set([primary.family]);
	const candidates = input.loaded
		.filter(
			(descriptor) =>
				!descriptor.isEmbedding &&
				descriptor.runtimeId !== primary.modelId &&
				(descriptor.loadedContextLength ?? 0) >= MIN_CONTEXT_TOKENS,
		)
		.sort((left, right) => descriptorScore(right) - descriptorScore(left));
	for (const descriptor of candidates) {
		const family = familyFor(descriptor.modelKey);
		// Unknown lineage is not evidence of independence. It may still serve as the single-model fallback, but two
		// unknown ids must never be advertised as cross-family deliberators.
		if (family === "unknown" || usedFamilies.has(family)) continue;
		chosen.push({
			...input.primary,
			modelId: descriptor.runtimeId,
			modelKey: descriptor.modelKey,
			contextWindow: descriptor.loadedContextLength ?? MIN_CONTEXT_TOKENS,
			family,
		});
		usedFamilies.add(family);
		if (chosen.length >= DELIBERATION_STANCES.length) break;
	}
	return chosen;
}

export function scoreSpecAmbiguity(specText: string): number {
	const heuristic = assessClarificationNeed(specText, "balanced").score;
	const lint = Math.min(1, lintSpecForDecompose(specText).length * 0.25);
	return Math.max(heuristic, lint);
}

export function renderSpecDeliberationGuidance(result: DeliberationResult): string[] {
	if (result.disagreements.length === 0) return [];
	const lines = [
		"## Pre-implementation specification disagreements",
		"Independent pre-code analysis found candidate ambiguities. Do not merge them into a guessed specification.",
		"Use the existing ask_followup_question path and ask EXACTLY ONE unresolved question per turn before decomposition.",
	];
	for (const [index, item] of result.disagreements.entries()) {
		lines.push(
			`${index + 1}. ${item.ambiguity} | readings: ${item.readings.join(" // ")} | raised by: ${item.raisedBy.join(", ")}`,
		);
	}
	lines.push(`Ask first: ${result.clarifyingQuestions[0] ?? "the first unresolved disagreement above"}`);
	lines.push(result.agreementCaveat);
	return lines;
}

/**
 * Run bounded, pre-sandbox spec deliberation. The injected turn owns admission/cancellation; this function owns only
 * staffing, prompt construction, failure degradation, and the honest disagreement projection.
 */
export async function runSpecDeliberation(input: {
	readonly specText: string;
	readonly difficulty: number;
	readonly primary: Omit<SpecDeliberationModel, "family" | "modelKey"> & { readonly modelKey?: string | null };
	readonly loaded: readonly LoadedModelDescriptor[];
	readonly runTurn: (request: {
		readonly model: SpecDeliberationModel;
		readonly stance: (typeof DELIBERATION_STANCES)[number];
		readonly prompt: string;
	}) => Promise<string | null>;
}): Promise<SpecDeliberationRunResult | null> {
	const models = selectSpecDeliberationModels({ primary: input.primary, loaded: input.loaded });
	const knownFamilies = new Set(models.map((model) => model.family).filter((family) => family !== "unknown"));
	const staffing = decideDeliberationStaffing({
		distinctFamilies: knownFamilies.size,
		anyModelLoaded: models.length > 0,
		ambiguity: scoreSpecAmbiguity(input.specText),
		difficulty: input.difficulty,
	});
	if (staffing.mode === "skipped" || !models[0]) return null;
	const assignments =
		staffing.mode === "cross_family"
			? models.slice(0, DELIBERATION_STANCES.length).map((model, index) => ({
					model,
					stance: DELIBERATION_STANCES[index] ?? DELIBERATION_STANCES[0],
				}))
			: DELIBERATION_STANCES.map((stance) => ({ model: models[0], stance }));
	const completed = (
		await Promise.all(
			assignments.map(async ({ model, stance }) => {
				const text = await input
					.runTurn({ model, stance, prompt: buildDeliberationPrompt({ specText: input.specText, stance }) })
					.catch(() => null);
				if (text === null) return null;
				const raisedBy = `${model.modelKey} as ${stance.id}`;
				return { model, raisedBy, ambiguities: parseDeliberationReply(text, raisedBy) };
			}),
		)
	).filter((entry): entry is NonNullable<typeof entry> => entry !== null);
	if (completed.length === 0) return null;
	if (staffing.mode === "cross_family" && new Set(completed.map((entry) => entry.model.family)).size < 2) {
		return null;
	}
	const deliberation = combineDeliberation({ perDeliberator: completed, mode: staffing.mode });
	return {
		mode: staffing.mode,
		staffingReason: staffing.reason,
		deliberation,
		completedModelIds: completed.map((entry) => entry.model.modelId),
		guidance: renderSpecDeliberationGuidance(deliberation),
	};
}

import { readFile } from "node:fs/promises";
import { type LlmfitModel, parseLlmfitModel } from "./llmfit-adapter";
import { normalizeModelNameForMatch } from "./llmfit-capability-prior";
import { llmfitRoutingPrior } from "./llmfit-fitness-bridge";
import type { ModelCapabilityEntry, ModelKind, SpeedClass } from "./model-capability-catalog";

/**
 * Converts the explicit llmfit GitHub catalog cache into a NON-authoritative catalog supplement.
 *
 * Ordering is load-bearing: these entries are meant to be consulted only after the user overlay and the shipped
 * empirical catalog. llmfit's Hugging Face metadata is useful for names, RAM/context/quant hints, and coarse use-case
 * tags, but its `tool_use` capability is only an unverified claim. Therefore every generated entry keeps
 * `toolUse: "UNKNOWN"`; measured !Klein verdicts continue to win.
 */

export interface LlmfitCatalogSupplementResult {
	entries: ModelCapabilityEntry[];
	errors: string[];
	revision: string | null;
	rawModelCount: number;
	parsedModelCount: number;
}

function asRecord(value: unknown): Record<string, unknown> | null {
	return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function str(value: unknown): string | null {
	return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function escapeRegex(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function modelRowsFromCache(raw: unknown): { rows: unknown[]; revision: string | null; sourceUrl: string | null } {
	const root = asRecord(raw);
	const metadata = asRecord(root?.metadata);
	const rows = Array.isArray(raw)
		? raw
		: Array.isArray(root?.models)
			? root.models
			: Array.isArray(root?.data)
				? root.data
				: Array.isArray(root?.rows)
					? root.rows
					: [];
	return {
		rows,
		revision: str(root?.revision) ?? str(metadata?.revision) ?? null,
		sourceUrl: str(metadata?.sourceUrl) ?? str(metadata?.downloadUrl) ?? null,
	};
}

function matchForModelName(name: string): { familySlug: string; match: RegExp } | null {
	const normalized = normalizeModelNameForMatch(name);
	if (normalized.length < 6) {
		return null;
	}
	const pattern = normalized
		.split("-")
		.filter((segment) => segment.length > 0)
		.map(escapeRegex)
		.join("[^a-z0-9]*");
	return {
		familySlug: normalized,
		match: new RegExp(pattern, "i"),
	};
}

function inferKind(model: LlmfitModel): ModelKind {
	const haystack = `${model.name} ${model.category ?? ""} ${model.capabilityIds.join(" ")}`.toLowerCase();
	if (/\b(code|coding|coder|programming)\b/.test(haystack)) {
		return "code";
	}
	if (/\b(reasoning|chain[_ -]?of[_ -]?thought|cot)\b/.test(haystack)) {
		return "reasoning";
	}
	if (/\b(agent|agentic)\b/.test(haystack)) {
		return "agentic";
	}
	if (/\b(roleplay|role-play|character)\b/.test(haystack)) {
		return "roleplay";
	}
	if (/\b(chat|assistant)\b/.test(haystack)) {
		return "chat";
	}
	if (/\b(instruct|general)\b/.test(haystack)) {
		return "instruct";
	}
	return "unknown";
}

function speedFromLlmfit(model: LlmfitModel): SpeedClass | undefined {
	const tier = llmfitRoutingPrior(model).speedTier;
	return tier ?? undefined;
}

function formatOptional(label: string, value: string | number | null | undefined): string | null {
	return value === null || value === undefined || value === "" ? null : `${label} ${value}`;
}

function buildNote(model: LlmfitModel): string {
	const prior = llmfitRoutingPrior(model);
	const parts = [
		formatOptional("fit", model.fitLevel),
		formatOptional("RAM", model.memoryRequiredGb === null ? null : `~${model.memoryRequiredGb} GB`),
		formatOptional("context", model.contextLength),
		formatOptional("quant", model.bestQuant),
		formatOptional("score", prior.capabilityPrior),
		formatOptional("speed", prior.estimatedTps === null ? null : `${prior.estimatedTps} tok/s`),
	].filter((part): part is string => part !== null);
	const toolClaim = model.capabilityIds.includes("tool_use") ? "claims tool_use" : "does not claim tool_use";
	return [
		`llmfit cached prior (${parts.length ? parts.join(", ") : "metadata only"}; ${toolClaim}).`,
		"Tool-use remains UNKNOWN until !Klein's empirical catalog or eval ledger verifies it.",
	].join(" ");
}

export function llmfitModelToCatalogSupplementEntry(
	model: LlmfitModel,
	sourceUrl: string | null = null,
): ModelCapabilityEntry | null {
	const match = matchForModelName(model.name);
	if (!match) {
		return null;
	}
	const sources = sourceUrl ? [sourceUrl] : [];
	const sizeGb = model.memoryRequiredGb && model.memoryRequiredGb > 0 ? model.memoryRequiredGb : undefined;
	return {
		family: `llmfit:${match.familySlug}`,
		match: match.match,
		toolUse: "UNKNOWN",
		kind: inferKind(model),
		speed: speedFromLlmfit(model),
		sizeGb,
		note: buildNote(model),
		sources,
		basis: "research",
		verified: false,
	};
}

export function parseLlmfitCatalogSupplement(raw: unknown): LlmfitCatalogSupplementResult {
	const { rows, revision, sourceUrl } = modelRowsFromCache(raw);
	const entries: ModelCapabilityEntry[] = [];
	const errors: string[] = [];
	const seenFamilies = new Set<string>();
	let parsedModelCount = 0;

	rows.forEach((row, index) => {
		const model = parseLlmfitModel(row);
		if (!model) {
			errors.push(`llmfit-catalog-cache: model[${index}] skipped — missing model name`);
			return;
		}
		parsedModelCount += 1;
		const entry = llmfitModelToCatalogSupplementEntry(model, sourceUrl);
		if (!entry) {
			errors.push(`llmfit-catalog-cache: model[${index}] (${model.name}) skipped — no stable match pattern`);
			return;
		}
		if (seenFamilies.has(entry.family)) {
			return;
		}
		seenFamilies.add(entry.family);
		entries.push(entry);
	});

	return { entries, errors, revision, rawModelCount: rows.length, parsedModelCount };
}

export async function loadLlmfitCatalogSupplement(path: string): Promise<LlmfitCatalogSupplementResult> {
	let text: string;
	try {
		text = await readFile(path, "utf8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			return { entries: [], errors: [], revision: null, rawModelCount: 0, parsedModelCount: 0 };
		}
		return {
			entries: [],
			errors: [`llmfit-catalog-cache: could not read ${path}: ${(error as Error).message}`],
			revision: null,
			rawModelCount: 0,
			parsedModelCount: 0,
		};
	}
	try {
		return parseLlmfitCatalogSupplement(JSON.parse(text));
	} catch (error) {
		return {
			entries: [],
			errors: [`llmfit-catalog-cache: ${path} is not valid JSON: ${(error as Error).message}`],
			revision: null,
			rawModelCount: 0,
			parsedModelCount: 0,
		};
	}
}

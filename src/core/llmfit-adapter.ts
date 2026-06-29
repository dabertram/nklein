/**
 * Adapter for `llmfit` (todo §5.AB; MIT, https://github.com/AlexsJones/llmfit) — a local CLI that scores models for
 * FIT (VRAM/RAM, per-quant, MoE-offload-aware) + SPEED (tok/s) + ranking against detected (or simulated) hardware.
 *
 * This module is the PURE half: tolerant parsers for its `--json` output (shapes captured in
 * [docs/dev/llmfit-spike.md](../../docs/dev/llmfit-spike.md)) + the small mappings !Klein consumes — so the effectful
 * shell-out (`uvx llmfit --json …` / a resolved binary, mirroring the guarded `lms` runner) stays a thin wrapper that
 * just feeds raw JSON in. llmfit owns FIT/SPEED; the §5.AL `MODEL_CAPABILITY_CATALOG` owns the EMPIRICAL tool-use
 * verdict (llmfit's `tool_use` is only a claimed-support tag) — they compose: llmfit narrows to fits+fast per pool,
 * §5.AL confirms it actually drives tool chains.
 */

/** llmfit's fit classification (best → worst). */
export type LlmfitFitLevel = "Perfect" | "Good" | "Marginal" | "Too Tight";

const FIT_LEVELS: readonly LlmfitFitLevel[] = ["Perfect", "Good", "Marginal", "Too Tight"];

export interface LlmfitModel {
	name: string;
	bestQuant: string | null;
	fitLevel: LlmfitFitLevel | null;
	memoryRequiredGb: number | null;
	memoryAvailableGb: number | null;
	estimatedTps: number | null;
	isMoe: boolean;
	moeOffloadedGb: number | null;
	/** llmfit detected this model already loaded in a local provider (LM Studio / Ollama / llama.cpp / MLX). */
	installed: boolean;
	contextLength: number | null;
	effectiveContextLength: number | null;
	/** Normalized capability ids (e.g. `vision`, `tool_use`) — a claimed-support tag, NOT the §5.AL verdict. */
	capabilityIds: string[];
	license: string | null;
}

export interface LlmfitSystem {
	totalRamGb: number | null;
	availableRamGb: number | null;
	gpuVramGb: number | null;
	gpuName: string | null;
	backend: string | null;
	cpuCores: number | null;
	unifiedMemory: boolean;
}

export interface LlmfitRecommendation {
	models: LlmfitModel[];
	system: LlmfitSystem | null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
	return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function num(value: unknown): number | null {
	return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function str(value: unknown): string | null {
	return typeof value === "string" && value.length > 0 ? value : null;
}

function strArray(value: unknown): string[] {
	return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

function parseFitLevel(value: unknown): LlmfitFitLevel | null {
	return typeof value === "string" && (FIT_LEVELS as readonly string[]).includes(value)
		? (value as LlmfitFitLevel)
		: null;
}

/** Parse one llmfit model entry (from `recommend`/`list`); returns null when it lacks a usable `name`. */
export function parseLlmfitModel(raw: unknown): LlmfitModel | null {
	const r = asRecord(raw);
	const name = r ? str(r.name) : null;
	if (!r || !name) {
		return null;
	}
	return {
		name,
		bestQuant: str(r.best_quant),
		fitLevel: parseFitLevel(r.fit_level),
		memoryRequiredGb: num(r.memory_required_gb),
		memoryAvailableGb: num(r.memory_available_gb),
		estimatedTps: num(r.estimated_tps),
		isMoe: r.is_moe === true,
		moeOffloadedGb: num(r.moe_offloaded_gb),
		installed: r.installed === true,
		contextLength: num(r.context_length),
		effectiveContextLength: num(r.effective_context_length),
		capabilityIds: strArray(r.capability_ids),
		license: str(r.license),
	};
}

function parseLlmfitSystem(raw: unknown): LlmfitSystem | null {
	const r = asRecord(raw);
	if (!r) {
		return null;
	}
	return {
		totalRamGb: num(r.total_ram_gb),
		availableRamGb: num(r.available_ram_gb),
		gpuVramGb: num(r.gpu_vram_gb),
		gpuName: str(r.gpu_name),
		backend: str(r.backend),
		cpuCores: num(r.cpu_cores),
		unifiedMemory: r.unified_memory === true,
	};
}

/** Parse `llmfit --json recommend` output (`{ models: [...], system: {...} }`); tolerant of missing pieces. */
export function parseLlmfitRecommend(raw: unknown): LlmfitRecommendation {
	const r = asRecord(raw);
	const modelsRaw = r && Array.isArray(r.models) ? r.models : Array.isArray(raw) ? raw : [];
	const models = modelsRaw.map(parseLlmfitModel).filter((m): m is LlmfitModel => m !== null);
	return { models, system: r ? parseLlmfitSystem(r.system) : null };
}

/** Parse `llmfit --json system` output (`{ system: {...} }`, or a bare system object). */
export function parseLlmfitSystemReport(raw: unknown): LlmfitSystem | null {
	const r = asRecord(raw);
	return r && r.system !== undefined ? parseLlmfitSystem(r.system) : parseLlmfitSystem(raw);
}

/**
 * Does the model CLEAR the fit bar (safe to load)? `Perfect`/`Good` ⇒ yes; `Marginal`/`Too Tight` ⇒ no; an unknown
 * fit level ⇒ no (conservative — don't load on missing data). Feeds `decideModelLoad` per pool.
 */
export function llmfitFitClears(model: LlmfitModel): boolean {
	return model.fitLevel === "Perfect" || model.fitLevel === "Good";
}

/** True when llmfit tags the model as claiming tool use (a cheap PRE-filter; the §5.AL verdict is authoritative). */
export function llmfitClaimsToolUse(model: LlmfitModel): boolean {
	return model.capabilityIds.includes("tool_use");
}

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
	/** llmfit's 0–100 quality×speed×fit score — the cold-start capability BASELINE (used as a routing prior). */
	score: number | null;
	/** llmfit's use-case category (e.g. `Coding`, `Multimodal`, `General`) — a skill-match signal. */
	category: string | null;
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
		score: num(r.score),
		category: str(r.category),
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

/**
 * Convert llmfit's `estimated_tps` (tokens/sec) into a predicted wall time (ms) for `outputTokens` — the
 * `predictedWallTimeMs` input the §5.AB `role-model-selection` / `model-pool-routing` comparators rank by. Null when
 * llmfit gave no usable tok/s (caller falls back to its observed-speed source). A rough estimate (decode only; ignores
 * prompt/TTFT), but enough to order candidates speed-wise when no measured wall time exists yet.
 */
export function llmfitPredictedWallTimeMs(model: LlmfitModel, outputTokens: number): number | null {
	if (model.estimatedTps === null || model.estimatedTps <= 0 || !(outputTokens > 0)) {
		return null;
	}
	return Math.round((outputTokens / model.estimatedTps) * 1000);
}

// ───────────────────────────── effectful runner (the thin shell-out half) ─────────────────────────────

/** Runs `llmfit` with argv, returns stdout + exit code. Injected so the calls are testable without a real binary. */
export type LlmfitRunner = (args: readonly string[]) => Promise<{ stdout: string; exitCode: number }>;

/** A machine's resource envelope, used to SIMULATE a pool (e.g. a laptop's 8 GB VRAM) from any host. */
export interface LlmfitMachineEnvelope {
	/** GPU VRAM override, llmfit `--memory` syntax (e.g. "8G", "8000M"). */
	vram?: string;
	/** System RAM override, `--ram` (e.g. "32G"). */
	ram?: string;
	/** CPU core override, `--cpu-cores`. */
	cpuCores?: number;
}

export interface LlmfitQueryOptions {
	/** Plan against THIS machine's envelope (per-pool simulation) instead of the detected host. */
	machine?: LlmfitMachineEnvelope;
	/** Cap context for the memory estimate (`--max-context`), e.g. the role's budget. */
	maxContext?: number;
}

/**
 * Pure: build the llmfit argv. Global flags (`--json` + the machine/context overrides) come BEFORE the subcommand
 * (llmfit is `llmfit [OPTIONS] [COMMAND]`). Keeping this pure makes the per-pool simulation args unit-testable.
 */
export function buildLlmfitArgs(subcommand: string, options: LlmfitQueryOptions = {}): string[] {
	const args = ["--json"];
	if (options.machine?.vram) {
		args.push("--memory", options.machine.vram);
	}
	if (options.machine?.ram) {
		args.push("--ram", options.machine.ram);
	}
	if (typeof options.machine?.cpuCores === "number" && Number.isFinite(options.machine.cpuCores)) {
		args.push("--cpu-cores", String(Math.trunc(options.machine.cpuCores)));
	}
	if (typeof options.maxContext === "number" && Number.isFinite(options.maxContext)) {
		args.push("--max-context", String(Math.trunc(options.maxContext)));
	}
	args.push(subcommand);
	return args;
}

function parseJsonSafe(stdout: string): unknown {
	try {
		return JSON.parse(stdout);
	} catch {
		return null;
	}
}

/** Run `llmfit recommend` for a machine/context envelope → parsed recommendation (empty on a non-zero exit / bad JSON). */
export async function llmfitRecommend(
	run: LlmfitRunner,
	options: LlmfitQueryOptions = {},
): Promise<LlmfitRecommendation> {
	const { stdout, exitCode } = await run(buildLlmfitArgs("recommend", options));
	if (exitCode !== 0) {
		return { models: [], system: null };
	}
	return parseLlmfitRecommend(parseJsonSafe(stdout));
}

/** Run `llmfit system` → the detected (or overridden) hardware, or null on a non-zero exit / bad JSON. */
export async function llmfitSystem(run: LlmfitRunner, options: LlmfitQueryOptions = {}): Promise<LlmfitSystem | null> {
	const { stdout, exitCode } = await run(buildLlmfitArgs("system", options));
	if (exitCode !== 0) {
		return null;
	}
	return parseLlmfitSystemReport(parseJsonSafe(stdout));
}

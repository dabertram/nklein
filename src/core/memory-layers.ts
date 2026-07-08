/**
 * §5.M LAYERED memory as one projection over the existing substrate (working · episodic · semantic · procedural).
 *
 * The long-horizon memory story is four layers, and the key insight is that !Klein ALREADY HOLDS all four — this module
 * PROJECTS them into one uniform read model ({@link MemoryRecord}) that the §5.AD turn-budget allocator's memory bands
 * consume, rather than inventing a new persisted store:
 *
 *   - **working**    — the active state + current step (the live task snapshot the caller injects);
 *   - **episodic**   — the immutable §5.AF event/attempt ledger (each attempt IS an episode: what was tried, how it went);
 *   - **semantic**   — FACTS distilled from episodes (per-model reliability, learned retry budgets) — reuses the existing
 *                      {@link buildModelFitnessFromLedger} projection so the "what we've learned" fact set never forks;
 *   - **procedural** — the §5.AE skill set (the available procedures/capabilities), from {@link SKILL_REGISTRY}.
 *
 * Every record carries a `salience` in [0,1] so a caller can rank memories into a bounded context band (highest first).
 * Pure + deterministic + total: no I/O, no clock — timestamps and the working snapshot are injected. Composes the
 * ledger + skill types by import only (it never edits them), mirroring `agent-ledger-projections.ts`.
 */

import type { AgentLedgerEvent } from "./agent-attempt-ledger.js";
import { buildModelFitnessFromLedger } from "./agent-ledger-projections.js";
import { SKILL_REGISTRY, type SkillId } from "./skill-registry.js";

export type MemoryLayerKind = "working" | "episodic" | "semantic" | "procedural";

/** One memory item, uniform across the four layers, ready to rank into a context budget band. */
export interface MemoryRecord {
	layer: MemoryLayerKind;
	/** Stable id within the layer (layer-prefixed) — de-dup + citation key. */
	id: string;
	/** The model/human-readable content of the memory. */
	text: string;
	/** When it happened / was last observed (ms), or null for timeless facts/capabilities. */
	recordedAt: number | null;
	/** Ranking weight in [0,1] — higher = keep first when the band is tight. */
	salience: number;
	/** Where it came from (for "why recalled" surfacing + audit). */
	provenance: string;
}

/** The live task state the WORKING layer projects — injected by the caller (the runtime's current state). */
export interface WorkingMemorySnapshot {
	taskId?: string | null;
	/** The active objective/goal in one line. */
	activeGoal?: string | null;
	/** The step the agent is currently on (e.g. the in-progress focus-chain step). */
	currentStep?: string | null;
}

function clamp01(value: number): number {
	return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

/**
 * Project the WORKING layer: the active goal + current step as the highest-salience memories (they anchor the turn).
 * Empty/absent fields are dropped so an empty snapshot yields no records.
 */
export function projectWorkingMemory(snapshot: WorkingMemorySnapshot): MemoryRecord[] {
	const records: MemoryRecord[] = [];
	const goal = snapshot.activeGoal?.trim();
	if (goal) {
		records.push({
			layer: "working",
			id: "working:goal",
			text: `Active goal: ${goal}`,
			recordedAt: null,
			salience: 1,
			provenance: snapshot.taskId ? `task ${snapshot.taskId}` : "active task",
		});
	}
	const step = snapshot.currentStep?.trim();
	if (step) {
		records.push({
			layer: "working",
			id: "working:step",
			text: `Current step: ${step}`,
			recordedAt: null,
			salience: 0.95,
			provenance: snapshot.taskId ? `task ${snapshot.taskId}` : "active task",
		});
	}
	return records;
}

/**
 * Project the EPISODIC layer over the §5.AF ledger: the most-recent ATTEMPT events as episodes, newest first, capped to
 * `limit` (default 8 — a lean recent-history window). Salience decays linearly with recency rank (newest = 1). A failed
 * outcome gets a small salience bump (a recent failure is more worth remembering than a routine success).
 */
export function projectEpisodicMemory(
	events: readonly AgentLedgerEvent[],
	options: { limit?: number } = {},
): MemoryRecord[] {
	const limit = Math.max(0, options.limit ?? 8);
	const attempts = events
		.filter((event): event is Extract<AgentLedgerEvent, { kind: "attempt" }> => event.kind === "attempt")
		.slice()
		.sort((left, right) => right.recordedAt - left.recordedAt)
		.slice(0, limit);
	return attempts.map((event, index) => {
		const recencyRank = limit > 0 ? 1 - index / limit : 0;
		const failed = event.outcome !== "success";
		return {
			layer: "episodic" as const,
			id: `episodic:${event.attemptId}`,
			text:
				`Attempt on ${event.taskId} via ${event.modelId} → ${event.outcome}` +
				(event.retriesBefore > 0
					? ` (after ${event.retriesBefore} retr${event.retriesBefore === 1 ? "y" : "ies"})`
					: "") +
				(event.salvage ? ` [salvaged: ${event.salvage}]` : ""),
			recordedAt: event.recordedAt,
			salience: clamp01(recencyRank + (failed ? 0.1 : 0)),
			provenance: `ledger attempt ${event.attemptId}`,
		};
	});
}

/**
 * Project the SEMANTIC layer: FACTS distilled from the episode stream — per (model × role × difficulty) reliability +
 * learned retry budget — by REUSING {@link buildModelFitnessFromLedger} (so the fact set never diverges from the §5.AB
 * fitness projection). Salience scales with sample count (a fact backed by more observations is more trustworthy),
 * saturating so a single well-sampled model can't crowd the band.
 */
export function projectSemanticMemory(events: readonly AgentLedgerEvent[]): MemoryRecord[] {
	return buildModelFitnessFromLedger(events).map((record) => ({
		layer: "semantic" as const,
		id: `semantic:${record.modelId}:${record.role}`,
		text:
			`${record.modelId} as ${record.role}: clears difficulty ≤${Math.round(record.maxDifficultyCleared * 100)}, ` +
			`quality ${Math.round(record.qualityScore * 100)}%, reliability ${Math.round(record.reliability * 100)}% ` +
			`over ${record.samples} sample(s); ~${record.avgRetriesNeeded.toFixed(1)} retries needed`,
		recordedAt: null,
		// More samples ⇒ more trustworthy; saturate at ~10 samples so one heavily-sampled cell can't dominate.
		salience: clamp01(0.3 + 0.7 * Math.min(1, record.samples / 10)),
		provenance: "learned from the §5.AF ledger",
	}));
}

/**
 * Project the PROCEDURAL layer over the §5.AE skill set: the available procedures/capabilities, optionally filtered to a
 * subset of skill ids (e.g. the ones the current role bundles). Timeless (recordedAt null); uniform high salience since
 * a capability is either available or not.
 */
export function projectProceduralMemory(skillIds?: readonly SkillId[]): MemoryRecord[] {
	const allow = skillIds ? new Set(skillIds) : null;
	return SKILL_REGISTRY.filter((skill) => allow === null || allow.has(skill.id)).map((skill) => ({
		layer: "procedural" as const,
		id: `procedural:${skill.id}`,
		text: `Skill ${skill.id}: ${skill.description}`,
		recordedAt: null,
		salience: 0.9,
		provenance: "§5.AE skill registry",
	}));
}

export interface MemoryLayersInput {
	snapshot?: WorkingMemorySnapshot;
	events?: readonly AgentLedgerEvent[];
	skillIds?: readonly SkillId[];
	/** Episodic recency-window cap (forwarded to {@link projectEpisodicMemory}). */
	episodicLimit?: number;
}

export interface MemoryLayers {
	working: MemoryRecord[];
	episodic: MemoryRecord[];
	semantic: MemoryRecord[];
	procedural: MemoryRecord[];
	/** All layers flattened, ranked salience-desc (stable) — ready to fill a context band top-down. */
	all: MemoryRecord[];
}

/**
 * Build all four memory layers from the injected substrate and a salience-ranked flat view. The flat `all` is a stable
 * sort (equal salience preserves layer order working→episodic→semantic→procedural) so the highest-value memories fill a
 * tight band first. Pure.
 */
export function buildMemoryLayers(input: MemoryLayersInput = {}): MemoryLayers {
	const working = projectWorkingMemory(input.snapshot ?? {});
	const episodic = projectEpisodicMemory(input.events ?? [], { limit: input.episodicLimit });
	const semantic = projectSemanticMemory(input.events ?? []);
	const procedural = projectProceduralMemory(input.skillIds);
	const all = [...working, ...episodic, ...semantic, ...procedural]
		.map((record, index) => ({ record, index }))
		.sort((left, right) => right.record.salience - left.record.salience || left.index - right.index)
		.map(({ record }) => record);
	return { working, episodic, semantic, procedural, all };
}

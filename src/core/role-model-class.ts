/**
 * Role → model-CLASS fit (todo §5.AB — the ≥3-agent parallel swarm, near-term user steer 2026-06-29).
 *
 * The user's swarm vision assigns a SUITABLE model per role: a strong **reasoning** model for planning
 * (architect) and reviewing, and a strong + fast **coding** model for the worker/implement role. This pure core
 * encodes that mapping as a deterministic *class-fit score* over the §5.AL capability catalog's two honest
 * dimensions — `kind` (`reasoning`/`code`/`agentic`/…) and `toolUse` (TOOL_NATIVE…TOOL_UNSUITABLE) — so the swarm
 * can rank the currently-LOADED models per role BEFORE the existing {@link import("./role-model-selection")}
 * `selectRoleModel` picks the best-fit *within* a role's pool by difficulty/free-first/speed.
 *
 * Two stages, cleanly separated:
 *  1. **class fit** (this module) — "is this model the right KIND for this role?" (reasoning vs coding vs tool-use).
 *  2. **instance pick** (`role-model-selection.ts`) — "among the right-kind models, which free one fits this task?".
 *
 * Pure + catalog-typed (no registry/SDK), so the role→class policy is unit-testable without a live model registry.
 * The optional tool-worker split (a dedicated fast tool-calling role distinct from the coder) is a separate §5.AB
 * leaf — deliberately NOT modeled here until that use case is confirmed non-overlapping; today the worker role
 * already weights tool use heavily, covering coding + tool calling in one.
 */

import type { ModelKind, ToolUseVerdict } from "./model-capability-catalog";
import { lookupModelCapability } from "./model-capability-catalog";

/** The canonical swarm roles backed by distinct loaded models (architect plans, worker implements, reviewer judges). */
export type SwarmRole = "architect" | "worker" | "reviewer";

export const SWARM_ROLES: readonly SwarmRole[] = ["architect", "worker", "reviewer"];

/** The two catalog dimensions the class-fit score reads — accept a bare shape so callers needn't pass a full entry. */
export interface ModelClassFacts {
	kind: ModelKind;
	toolUse: ToolUseVerdict;
}

interface RoleClassPreference {
	/** Human-readable role intent (for the rationale + UI). */
	label: string;
	/** Per-kind suitability weight (0–1); kinds omitted score 0. */
	kindWeights: Partial<Record<ModelKind, number>>;
	/** Share of the final score driven by the tool-use verdict (the rest comes from `kind`). 0–1. */
	toolUseWeight: number;
	/** When true, a TOOL_UNSUITABLE model is INELIGIBLE for the role (the worker must be able to call tools). */
	requiresToolUse: boolean;
	rationale: string;
}

/**
 * Role → preferred model class. Architect/reviewer are reasoning-led (the user: "strong reasoning for planning and
 * reviewing"); the worker is coding-led with tool use as half the job. Tool use is still weighted for the architect
 * (it must emit the decompose call) but does not gate eligibility there — a strong reasoning model is the point, and
 * the §5.AA constrained-decoding rung can force its single planning call.
 */
export const ROLE_MODEL_CLASS_PREFERENCES: Record<SwarmRole, RoleClassPreference> = {
	architect: {
		label: "planning / decomposition",
		kindWeights: { reasoning: 1.0, agentic: 0.85, instruct: 0.7, code: 0.55, chat: 0.2, roleplay: 0.0, unknown: 0.4 },
		toolUseWeight: 0.3,
		requiresToolUse: false,
		rationale: "Planning is reasoning-led; a strong reasoning (or agentic) model decomposes best.",
	},
	worker: {
		label: "coding / implementation",
		kindWeights: { code: 1.0, agentic: 1.0, instruct: 0.75, reasoning: 0.5, chat: 0.15, roleplay: 0.0, unknown: 0.4 },
		toolUseWeight: 0.5,
		requiresToolUse: true,
		rationale: "Implementation needs strong + fast coding AND reliable tool calling (edit/run tools).",
	},
	reviewer: {
		label: "review / defect-finding",
		kindWeights: { reasoning: 1.0, agentic: 0.8, instruct: 0.75, code: 0.7, chat: 0.25, roleplay: 0.0, unknown: 0.4 },
		toolUseWeight: 0.15,
		requiresToolUse: false,
		rationale: "Reviewing is reasoning-led (catch planted defects); tool use is barely needed.",
	},
};

/** Tool-use verdict → a 0–1 reliability weight (NATIVE best, UNSUITABLE worst, UNKNOWN neutral). */
const TOOL_USE_WEIGHT: Record<ToolUseVerdict, number> = {
	TOOL_NATIVE: 1.0,
	TOOL_CAPABLE: 0.8,
	TOOL_WEAK: 0.3,
	TOOL_UNSUITABLE: 0.0,
	UNKNOWN: 0.5,
};

export interface RoleModelClassFit {
	role: SwarmRole;
	/** 0–100 class-fit score (kind weight blended with tool-use weight per the role's `toolUseWeight`). */
	score: number;
	/** False when the role requires tool use and the model is TOOL_UNSUITABLE — the swarm must not assign it here. */
	eligible: boolean;
	rationale: string;
}

/** Pure: how well a model's CLASS (kind + tool-use) fits a swarm role. Higher score = better class fit. */
export function scoreModelClassFitForRole(role: SwarmRole, facts: ModelClassFacts): RoleModelClassFit {
	const pref = ROLE_MODEL_CLASS_PREFERENCES[role];
	const kindWeight = pref.kindWeights[facts.kind] ?? 0;
	const toolWeight = TOOL_USE_WEIGHT[facts.toolUse];
	const score = Math.round((kindWeight * (1 - pref.toolUseWeight) + toolWeight * pref.toolUseWeight) * 100);
	const eligible = !(pref.requiresToolUse && facts.toolUse === "TOOL_UNSUITABLE");
	const rationale = eligible
		? `${facts.kind}/${facts.toolUse} fits ${pref.label} (score ${score}).`
		: `${facts.kind}/${facts.toolUse} cannot be a ${role}: the role requires tool use but the model is tool-unsuitable.`;
	return { role, score: eligible ? score : 0, eligible, rationale };
}

export interface RankedRoleModel extends RoleModelClassFit {
	modelKey: string;
}

/**
 * Rank candidate models for a role by class fit, eligible-first then score-desc (stable by `modelKey`). Candidates
 * may carry explicit {@link ModelClassFacts}; when omitted, the §5.AL catalog is consulted by id (an unknown id
 * resolves to `{ kind: "unknown", toolUse: "UNKNOWN" }`, i.e. a neutral, never-ineligible fallback).
 */
export function rankModelsForRole(
	role: SwarmRole,
	candidates: readonly { modelKey: string; facts?: ModelClassFacts }[],
): RankedRoleModel[] {
	return candidates
		.map(({ modelKey, facts }) => {
			const resolved = facts ?? factsFromCatalog(modelKey);
			return { modelKey, ...scoreModelClassFitForRole(role, resolved) };
		})
		.sort((a, b) => {
			if (a.eligible !== b.eligible) {
				return a.eligible ? -1 : 1;
			}
			if (a.score !== b.score) {
				return b.score - a.score;
			}
			return a.modelKey.localeCompare(b.modelKey);
		});
}

function factsFromCatalog(modelId: string): ModelClassFacts {
	const entry = lookupModelCapability(modelId);
	return entry ? { kind: entry.kind, toolUse: entry.toolUse } : { kind: "unknown", toolUse: "UNKNOWN" };
}

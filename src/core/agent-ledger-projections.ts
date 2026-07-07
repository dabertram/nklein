/**
 * Projections that bridge the Agent Attempt Ledger (§5.AF — the ONE evidence stream) to the learning/selection layers,
 * so those become QUERIES over the ledger instead of parallel persisted stores. The ledger now has a live writer
 * (terminal task runs append `attempt` events), so these projections operate on real data.
 *
 * `summarizeModelOutcomes` (per-model outcome counts) lives in the ledger core; this module adds the richer
 * `ModelBehaviorProfile` (§5.AA) projection — folding each model's attempts through the same online-learning update the
 * adaptive retry engine reads, so "what works per model" is derived from the durable record, not a second store.
 */

import type { SelfObservationEventRecord } from "../telemetry/self-observation-sink";
import {
	type AgentAttemptEvent,
	type AgentLedgerEvent,
	type ModelContextUsageRollup,
	type ModelOutcomeRollup,
	type ModelSpeedRollup,
	type ModelToolUsageRollup,
	selectAttempts,
	summarizeModelContextUsage,
	summarizeModelOutcomes,
	summarizeModelSpeed,
	summarizeToolUsageByModel,
} from "./agent-attempt-ledger";
import type { AgentStucknessSignals } from "./agent-stuckness";
import { buildFailureCapsule, type FailureCapsule, summarizeFailureCapsules } from "./failure-capsule";
import {
	emptyModelBehaviorProfile,
	type ModelAttemptOutcome,
	type ModelBehaviorProfile,
	type ModelOutcomeKind,
	recordModelBehaviorOutcome,
} from "./model-behavior-profile";
import type { ToolUseVerdict } from "./model-capability-catalog";
import { computeModelFitness, type FitnessWeights, type ModelFitnessRecord } from "./model-fitness";
import type { RetryStrategy } from "./retry-policy";
import {
	assessRuntimeModelVerdict,
	penalizeFitnessByRuntimeVerdict,
	type RuntimeRunOutcome,
} from "./runtime-model-verdict";

/**
 * Derive a `ModelBehaviorProfile` per model by folding that model's ledger attempts (chronologically) through the
 * §5.AA online-learning update. Pure; returns one profile per model, sorted by samples desc then modelId. The
 * terminal-run writer is coarse (no per-tool-call format / quality grading yet), so `toolCallFormat` is absent and
 * `toolCount` is only supplied when the attempt recorded an offered tool set — a richer writer fills these later.
 */
export function buildModelBehaviorProfilesFromLedger(
	events: readonly AgentLedgerEvent[],
	options?: { alpha?: number },
): ModelBehaviorProfile[] {
	const attempts = [...selectAttempts(events)].sort((left, right) => left.recordedAt - right.recordedAt);
	const byModel = new Map<string, ModelBehaviorProfile>();
	for (const attempt of attempts) {
		const current = byModel.get(attempt.modelId) ?? emptyModelBehaviorProfile(attempt.modelId, attempt.recordedAt);
		const outcome: ModelAttemptOutcome = {
			kind: attempt.outcome,
			retries: attempt.retriesBefore,
			...(attempt.contextTokens !== null ? { contextTokens: attempt.contextTokens } : {}),
			...(attempt.qualityOk !== null ? { qualityOk: attempt.qualityOk } : {}),
			...(attempt.toolSetOffered.length > 0 ? { toolCount: attempt.toolSetOffered.length } : {}),
		};
		byModel.set(
			attempt.modelId,
			recordModelBehaviorOutcome(current, outcome, { alpha: options?.alpha, now: () => attempt.recordedAt }),
		);
	}
	return [...byModel.values()].sort(
		(left, right) => right.samples - left.samples || left.modelId.localeCompare(right.modelId),
	);
}

/** A per-(model, role) outcome rollup — the §5.Z cross-model matrix (model × board flow) as a ledger query. */
export interface ModelRoleOutcomeRollup extends ModelOutcomeRollup {
	/** architect | worker | reviewer (the board role ≈ the §5.Z flow: decompose / single-card / review). */
	role: string;
}

function emptyLedgerOutcomeCounts(): Record<ModelOutcomeKind, number> {
	return { success: 0, no_tool_call: 0, narrated: 0, loop: 0, timeout: 0, malformed: 0, aborted: 0, other_failure: 0 };
}

/**
 * Roll up attempts per (model, role) — the §5.Z matrix (which model clears which flow) as a pure ledger query rather
 * than a hand-maintained table. Sorted by samples desc, then modelId, then role.
 */
export function summarizeModelOutcomesByRole(events: readonly AgentLedgerEvent[]): ModelRoleOutcomeRollup[] {
	const byKey = new Map<string, { modelId: string; role: string; byOutcome: Record<ModelOutcomeKind, number> }>();
	for (const attempt of selectAttempts(events)) {
		const role = attempt.role ?? "worker";
		const key = `${attempt.modelId}\u0000${role}`;
		const entry = byKey.get(key) ?? { modelId: attempt.modelId, role, byOutcome: emptyLedgerOutcomeCounts() };
		entry.byOutcome[attempt.outcome] += 1;
		byKey.set(key, entry);
	}
	const rollups: ModelRoleOutcomeRollup[] = [];
	for (const { modelId, role, byOutcome } of byKey.values()) {
		const samples = Object.values(byOutcome).reduce((sum, count) => sum + count, 0);
		rollups.push({
			modelId,
			role,
			samples,
			successes: byOutcome.success,
			successRate: samples > 0 ? byOutcome.success / samples : 0,
			byOutcome,
		});
	}
	rollups.sort(
		(left, right) =>
			right.samples - left.samples ||
			left.modelId.localeCompare(right.modelId) ||
			left.role.localeCompare(right.role),
	);
	return rollups;
}

/** A per-(model, flow) outcome rollup — the §5.Z matrix broken out by the FLOW the attempt ran under. */
export interface ModelFlowOutcomeRollup extends ModelOutcomeRollup {
	/** `board` (a task run) | `chat` | `autonomous` — `flow` null on an attempt is treated as `board`. */
	flow: string;
}

/**
 * Roll up attempts per (model, flow) — the §5.Z matrix broken out by FLOW (board task / chat / autonomous), now that
 * each writer stamps `attempt.flow` (chat does; the terminal writer leaves it null = `board`). Shows whether a model
 * that's solid on board tasks is also reliable in chat, etc. Sorted by samples desc, then modelId, then flow.
 */
export function summarizeModelOutcomesByFlow(events: readonly AgentLedgerEvent[]): ModelFlowOutcomeRollup[] {
	const byKey = new Map<string, { modelId: string; flow: string; byOutcome: Record<ModelOutcomeKind, number> }>();
	for (const attempt of selectAttempts(events)) {
		const flow = attempt.flow ?? "board";
		// Null-byte separator (matching summarizeModelOutcomesByRole / buildModelFitnessFromLedger): a SPACE is a
		// legal char in both modelId (LM Studio display names like "Qwen 3 8B") and flow, so a space delimiter lets
		// ("model A","board") collide with ("model","A board") and merge two distinct rows into one.
		const key = `${attempt.modelId}\u0000${flow}`;
		const entry = byKey.get(key) ?? { modelId: attempt.modelId, flow, byOutcome: emptyLedgerOutcomeCounts() };
		entry.byOutcome[attempt.outcome] += 1;
		byKey.set(key, entry);
	}
	const rollups: ModelFlowOutcomeRollup[] = [];
	for (const { modelId, flow, byOutcome } of byKey.values()) {
		const samples = Object.values(byOutcome).reduce((sum, count) => sum + count, 0);
		rollups.push({
			modelId,
			flow,
			samples,
			successes: byOutcome.success,
			successRate: samples > 0 ? byOutcome.success / samples : 0,
			byOutcome,
		});
	}
	rollups.sort(
		(left, right) =>
			right.samples - left.samples ||
			left.modelId.localeCompare(right.modelId) ||
			left.flow.localeCompare(right.flow),
	);
	return rollups;
}

/** A one-shot display rollup of the whole ledger — for the operator read surfaces (`nklein dev ledger`). */
export interface LedgerDisplaySummary {
	totalEvents: number;
	totalAttempts: number;
	/** Per-model outcome counts + success rate (the §5.Z matrix seed). */
	outcomes: ModelOutcomeRollup[];
	/** Per-(model, role) outcome counts — the §5.Z matrix as a ledger query. */
	byRole: ModelRoleOutcomeRollup[];
	/** Per-(model, flow) outcome counts — the §5.Z matrix broken out by board/chat/autonomous flow. */
	byFlow: ModelFlowOutcomeRollup[];
	/** Per-model learned behaviour profiles (§5.AA) derived from the ledger. */
	profiles: ModelBehaviorProfile[];
	/** Per-(model, tool) usage + outcome counts — which tools each model leans on and where it fails (§5.AA). */
	toolUsage: ModelToolUsageRollup[];
	/** Per-model speed (ttft + tok/s) from the ledger — a §5.AB selection signal alongside the outcome rollup. */
	speed: ModelSpeedRollup[];
	/** Per-model context usage (avg/max prompt tokens + over-budget count) — a §5.AD budget / §5.AB routing input. */
	contextUsage: ModelContextUsageRollup[];
}

/**
 * Derive coarse §5.AB `ModelFitnessRecord`s per (model, role) from the ledger. COARSE by construction at this stage:
 * the terminal writer has no graded quality or difficulty, so `qualityScore` + `reliability` both proxy the success
 * rate and `maxDifficultyCleared` is 0 (the §5.AB eval harness fills graded quality + difficulty later). `avgLatencyMs`
 * + `avgRetriesNeeded` are real. Enough for a first success-rate/speed-weighted ranking via `computeModelFitness`.
 */
export function buildModelFitnessFromLedger(events: readonly AgentLedgerEvent[]): ModelFitnessRecord[] {
	interface Accumulator {
		modelId: string;
		role: string;
		samples: number;
		successes: number;
		latencySum: number;
		latencyCount: number;
		retriesSum: number;
	}
	const groups = new Map<string, Accumulator>();
	for (const attempt of selectAttempts(events)) {
		const role = attempt.role ?? "worker";
		const key = `${attempt.modelId}\u0000${role}`;
		const group = groups.get(key) ?? {
			modelId: attempt.modelId,
			role,
			samples: 0,
			successes: 0,
			latencySum: 0,
			latencyCount: 0,
			retriesSum: 0,
		};
		group.samples += 1;
		if (attempt.outcome === "success") {
			group.successes += 1;
		}
		if (attempt.startedAt !== null && attempt.completedAt !== null && attempt.completedAt > attempt.startedAt) {
			group.latencySum += attempt.completedAt - attempt.startedAt;
			group.latencyCount += 1;
		}
		group.retriesSum += attempt.retriesBefore;
		groups.set(key, group);
	}
	return [...groups.values()]
		.map((group): ModelFitnessRecord => {
			const successRate = group.samples > 0 ? group.successes / group.samples : 0;
			return {
				modelId: group.modelId,
				role: group.role,
				maxDifficultyCleared: 0,
				qualityScore: successRate,
				reliability: successRate,
				avgLatencyMs: group.latencyCount > 0 ? group.latencySum / group.latencyCount : 0,
				avgRetriesNeeded: group.samples > 0 ? group.retriesSum / group.samples : 0,
				samples: group.samples,
			};
		})
		.sort(
			(left, right) =>
				right.samples - left.samples ||
				left.modelId.localeCompare(right.modelId) ||
				left.role.localeCompare(right.role),
		);
}

/** A ledger-fitness record with its computed §5.AB fitness score — the data-driven routing recommendation. */
export interface RankedModelFitness extends ModelFitnessRecord {
	/** `computeModelFitness(record)` — higher is better (quality + reliability + speed, penalized by retries). */
	fitnessScore: number;
}

/**
 * Rank models by their LEDGER-derived §5.AB fitness (todo §5.AF — the read-side of live consumption). Composes
 * `buildModelFitnessFromLedger` + `computeModelFitness` into one ordered "best model per (model, role) from real runs"
 * list — what the §5.AB selection path should route on (and what `nklein dev ledger` shows the operator). Pure;
 * sorted by fitness score desc, then samples desc (more evidence breaks ties), then modelId/role. Optional `role`
 * filter. Today's fitness is coarse (success-rate-proxy quality + real latency/retries) until the eval harness grades it.
 */
export function rankModelsByLedgerFitness(
	events: readonly AgentLedgerEvent[],
	options?: { role?: string; weights?: FitnessWeights },
): RankedModelFitness[] {
	const records = buildModelFitnessFromLedger(events).filter(
		(record) => options?.role === undefined || record.role === options.role,
	);
	return records
		.map((record): RankedModelFitness => ({ ...record, fitnessScore: computeModelFitness(record, options?.weights) }))
		.sort(
			(left, right) =>
				right.fitnessScore - left.fitnessScore ||
				right.samples - left.samples ||
				left.modelId.localeCompare(right.modelId) ||
				left.role.localeCompare(right.role),
		);
}

/**
 * Rank models by ledger fitness AND apply the runtime-verdict penalty the START PATH actually routes on (§5.AB/§5.AL) —
 * so an operator-facing "routing recommendation" (e.g. `nklein dev ledger`) ranks the same way selection does, instead
 * of by raw fitness that ignores chronic stalls. The penalty mirrors `createCapabilityBlender`'s inline multiplier
 * exactly (`TOOL_UNSUITABLE` ×0.1, `TOOL_WEAK` ×0.5, else ×1), sourced from the SAME evidence: self-observation events
 * (failures) + the ledger's total-run list (the denominator). Pure; a model with no verdict evidence is unchanged, so
 * with an empty `selfObservationEvents`/`verdictRuns` this is byte-identical to {@link rankModelsByLedgerFitness}.
 */
export function rankModelsByLedgerFitnessWithVerdict(
	events: readonly AgentLedgerEvent[],
	options: {
		selfObservationEvents: readonly SelfObservationEventRecord[];
		verdictRuns: readonly RuntimeRunOutcome[];
		role?: string;
		weights?: FitnessWeights;
	},
): RankedModelFitness[] {
	const rankOptions = {
		...(options.role !== undefined ? { role: options.role } : {}),
		...(options.weights !== undefined ? { weights: options.weights } : {}),
	};
	const ranked = rankModelsByLedgerFitness(events, rankOptions);
	if (options.selfObservationEvents.length === 0 && options.verdictRuns.length === 0) {
		return ranked; // no verdict evidence ⇒ nothing to penalize; identical ordering to the base rank.
	}
	// Memoize per distinct modelId — the same model can appear across several roles.
	const verdictByModelId = new Map<string, ToolUseVerdict>();
	for (const row of ranked) {
		if (!verdictByModelId.has(row.modelId)) {
			verdictByModelId.set(
				row.modelId,
				assessRuntimeModelVerdict({
					modelId: row.modelId,
					events: options.selfObservationEvents,
					runs: options.verdictRuns,
				}).verdict,
			);
		}
	}
	return penalizeFitnessByRuntimeVerdict(ranked, verdictByModelId);
}

/**
 * Blend a model's registry capability (0–100) with its LEDGER-observed success rate, evidence-gated (todo §5.AF live
 * consumption). The §5.AB selection routes on `capability`; this nudges that score toward what the model ACTUALLY does
 * on real runs, so a model that looks strong on paper but reliably fails (or vice-versa) gets re-ranked from evidence —
 * WITHOUT throwing away the registry prior. SAFE FALLBACK: below `minSamples` real runs (default 3) the score is
 * returned UNCHANGED, so a new / under-observed model — and an empty ledger — behaves exactly as today. The shift is
 * weighted by evidence (more samples → more pull, capped at `evidenceCap`) and clamped to ±`maxShift` so one streak
 * can't flip the ranking wildly. `successRate` null (no ledger row) ⇒ unchanged.
 */
export function blendCapabilityWithLedgerEvidence(
	baseCapability: number,
	successRate: number | null,
	samples: number,
	options?: { minSamples?: number; evidenceCap?: number; maxShift?: number },
): number {
	const minSamples = options?.minSamples ?? 3;
	const evidenceCap = options?.evidenceCap ?? 20;
	const maxShift = options?.maxShift ?? 30;
	if (successRate === null || samples < minSamples) {
		return baseCapability;
	}
	const observed = successRate * 100; // the observed success rate as a 0–100 capability proxy
	const weight = Math.min(samples, evidenceCap) / evidenceCap; // 0..1, grows with evidence
	const rawShift = (observed - baseCapability) * weight;
	const shift = Math.max(-maxShift, Math.min(maxShift, rawShift));
	return Math.max(0, Math.min(100, baseCapability + shift));
}

/** Project the ledger into the operator display summary (pure; composes the two model projections). */
export function summarizeLedgerForDisplay(events: readonly AgentLedgerEvent[]): LedgerDisplaySummary {
	return {
		totalEvents: events.length,
		totalAttempts: selectAttempts(events).length,
		outcomes: summarizeModelOutcomes(events),
		byRole: summarizeModelOutcomesByRole(events),
		byFlow: summarizeModelOutcomesByFlow(events),
		profiles: buildModelBehaviorProfilesFromLedger(events),
		toolUsage: summarizeToolUsageByModel(events),
		speed: summarizeModelSpeed(events),
		contextUsage: summarizeModelContextUsage(events),
	};
}

/** A stable key for an attempt's "approach" — the §5.AA levers it varied (endpoint × prompt × tool-set × simplify). */
function attemptApproachKey(attempt: AgentAttemptEvent): string {
	return [
		attempt.endpointStrategy ?? "",
		attempt.promptStrategy ?? "",
		attempt.simplificationLevel,
		[...attempt.toolSetOffered].sort().join(","),
	].join("|");
}

export interface StucknessSignalsOptions {
	/**
	 * Whether the learned per-model retry budget is exhausted for the current failure class — a budget comparison the
	 * ledger can't supply on its own, so the §5.AB budget subsystem passes it in (defaults false).
	 */
	retryBudgetExhausted?: boolean;
}

/**
 * Project the §5.AF ledger's attempt stream for one task into the `AgentStucknessSignals` the §5.AB hard-limit detector
 * (`classifyAgentStuckness`) reads. Pure. The "current stuck episode" is the trailing run of consecutive non-`success`
 * attempts (a success ends it); over that episode it derives the outcome sequence, how many DISTINCT approaches were
 * tried (endpoint × prompt × tool-set × simplification), whether a loop was detected but NOT salvaged, and whether any
 * forward progress (a produced artifact) landed while still failing. `retryBudgetExhausted` comes from the caller.
 */
export function buildStucknessSignalsFromLedger(
	events: readonly AgentLedgerEvent[],
	taskId: string,
	options: StucknessSignalsOptions = {},
): AgentStucknessSignals {
	const attempts = selectAttempts(events)
		.filter((attempt) => attempt.taskId === taskId)
		.sort((left, right) => left.recordedAt - right.recordedAt);

	// The current stuck episode = the trailing run of consecutive non-success attempts (a success ends the episode).
	const episode: AgentAttemptEvent[] = [];
	for (let index = attempts.length - 1; index >= 0; index--) {
		const attempt = attempts[index];
		if (attempt.outcome === "success") {
			break;
		}
		episode.push(attempt);
	}
	episode.reverse();

	const approaches = new Set<string>();
	let loopUncleared = false;
	let hadProgressSinceStuck = false;
	for (const attempt of episode) {
		approaches.add(attemptApproachKey(attempt));
		if (attempt.outcome === "loop" && attempt.salvage === null) {
			loopUncleared = true;
		}
		if (attempt.artifacts !== null) {
			hadProgressSinceStuck = true;
		}
	}

	return {
		recentOutcomes: episode.map((attempt) => attempt.outcome),
		distinctApproachesTried: approaches.size,
		loopUncleared,
		retryBudgetExhausted: options.retryBudgetExhausted ?? false,
		hadProgressSinceStuck,
	};
}

// ---------------------------------------------------------------------------
// Capability-ceiling → user-facing model advice (§5.AB; the user-advice value of the §5.Z/§5.AB ceiling data)
// ---------------------------------------------------------------------------

/** Per-(model, role) recommendation derived from the ledger's observed outcomes. */
export type ModelRoleVerdict = "recommended" | "usable" | "not_recommended" | "insufficient_data";

export interface ModelRoleAdvice {
	role: string;
	modelId: string;
	verdict: ModelRoleVerdict;
	samples: number;
	successRate: number;
	/** When not recommended, the dominant non-success outcome (the "why") — e.g. `timeout`, `no_tool_call`. */
	topFailureMode: ModelOutcomeKind | null;
}

export interface ModelCapabilityAdvice {
	/** Per-(role, model) verdicts, sorted by role then successRate desc then modelId. */
	perRole: ModelRoleAdvice[];
	/** Human-readable one-liners — for the Settings / `nklein dev` advisory surface. */
	notes: string[];
}

export interface ModelCapabilityAdviceThresholds {
	/** Below this many samples a verdict is `insufficient_data` (don't judge prematurely). Default 3. */
	minSamples?: number;
	/** successRate ≥ this ⇒ `recommended`. Default 0.8. */
	recommendRate?: number;
	/** successRate < this ⇒ `not_recommended` (a capability-floor for the role). Default 0.4. */
	avoidRate?: number;
}

function dominantFailureOutcome(byOutcome: Record<ModelOutcomeKind, number>): ModelOutcomeKind | null {
	let top: ModelOutcomeKind | null = null;
	let best = 0;
	for (const [kind, count] of Object.entries(byOutcome) as [ModelOutcomeKind, number][]) {
		if (kind !== "success" && count > best) {
			best = count;
			top = kind;
		}
	}
	return top;
}

/**
 * Project the ledger's per-(model × role) outcomes into **user-facing model advice** — which models suit which role,
 * which hit a capability floor, and why (§5.AB; the user-advice value of the §5.Z/§5.AB ceiling data the user called
 * out 2026-06-28). Pure. **Doesn't judge prematurely:** a (model, role) with fewer than `minSamples` attempts is
 * `insufficient_data`, never a floor — a floor verdict needs enough evidence (reliability is a §5.AB signal). The
 * `topFailureMode` gives the "why" for a not-recommended pairing (e.g. it times out, or never calls tools).
 */
export function buildModelCapabilityAdvice(
	events: readonly AgentLedgerEvent[],
	thresholds: ModelCapabilityAdviceThresholds = {},
): ModelCapabilityAdvice {
	const minSamples = Math.max(1, Math.trunc(thresholds.minSamples ?? 3));
	const recommendRate = thresholds.recommendRate ?? 0.8;
	const avoidRate = thresholds.avoidRate ?? 0.4;

	const perRole: ModelRoleAdvice[] = summarizeModelOutcomesByRole(events).map((rollup) => {
		const verdict: ModelRoleVerdict =
			rollup.samples < minSamples
				? "insufficient_data"
				: rollup.successRate >= recommendRate
					? "recommended"
					: rollup.successRate < avoidRate
						? "not_recommended"
						: "usable";
		return {
			role: rollup.role,
			modelId: rollup.modelId,
			verdict,
			samples: rollup.samples,
			successRate: rollup.successRate,
			topFailureMode: verdict === "not_recommended" ? dominantFailureOutcome(rollup.byOutcome) : null,
		};
	});
	perRole.sort(
		(left, right) =>
			left.role.localeCompare(right.role) ||
			right.successRate - left.successRate ||
			left.modelId.localeCompare(right.modelId),
	);

	const roles = [...new Set(perRole.map((advice) => advice.role))].sort();
	const notes: string[] = [];
	const pct = (rate: number): string => `${Math.round(rate * 100)}%`;
	for (const role of roles) {
		const forRole = perRole.filter((advice) => advice.role === role);
		const recommended = forRole.filter((a) => a.verdict === "recommended");
		const avoid = forRole.filter((a) => a.verdict === "not_recommended");
		const parts: string[] = [];
		if (recommended.length > 0) {
			parts.push(
				`recommended: ${recommended.map((a) => `${a.modelId} (${pct(a.successRate)}, n=${a.samples})`).join(", ")}`,
			);
		}
		if (avoid.length > 0) {
			parts.push(
				`avoid: ${avoid.map((a) => `${a.modelId} (${pct(a.successRate)}, n=${a.samples}${a.topFailureMode ? `, mostly ${a.topFailureMode}` : ""})`).join(", ")}`,
			);
		}
		notes.push(parts.length > 0 ? `${role}: ${parts.join("; ")}` : `${role}: insufficient data to advise yet`);
	}
	return { perRole, notes };
}

/**
 * Project a workflow's prior ledger attempts into the §5.AA "already tried — do not repeat" note for the NEXT attempt's
 * context (the §5.AF "resume + explain exactly, don't re-ask a weak model to rediscover state" goal — so after a restart
 * or a fresh rung the controller can reconstruct what was tried from the durable record). Selects the workflow's
 * NON-success attempts chronologically, maps each to a failure capsule (deriving the rung it applied from the recorded
 * levers), and renders the compact note via the §5.AA failure-capsule core. Empty string when there are no prior
 * failed attempts.
 */
export function buildAttemptRetryNoteFromLedger(
	events: readonly AgentLedgerEvent[],
	options: { workflowId?: string } = {},
): string {
	const attempts = [...selectAttempts(events)]
		.filter((attempt) => (options.workflowId ? attempt.workflowId === options.workflowId : true))
		.filter((attempt) => attempt.outcome !== "success")
		.sort((left, right) => left.recordedAt - right.recordedAt);
	return summarizeFailureCapsules(attempts.map(attemptToFailureCapsule));
}

function attemptToFailureCapsule(attempt: AgentAttemptEvent): FailureCapsule {
	return buildFailureCapsule({
		strategy: inferAttemptStrategy(attempt),
		outcome: attempt.outcome,
		evidence: attemptEvidence(attempt),
	});
}

/** Best-effort map an attempt's recorded levers to the retry rung it represents (for the do-not-repeat note). */
function inferAttemptStrategy(attempt: AgentAttemptEvent): RetryStrategy {
	if (attempt.simplificationLevel > 0) {
		return "reduced_tool_set";
	}
	const prompt = (attempt.promptStrategy ?? "").toLowerCase();
	if (prompt.includes("constrain") || prompt.includes("schema")) {
		return "constrained_schema";
	}
	if (prompt.includes("variant") || prompt.includes("prompt")) {
		return "prompt_variant";
	}
	if (attempt.endpointStrategy) {
		return "alternate_endpoint";
	}
	return "same_model_retry";
}

function attemptEvidence(attempt: AgentAttemptEvent): string {
	const parts: string[] = [`model=${attempt.modelId}`];
	if (attempt.salvage) {
		parts.push(`salvage=${attempt.salvage}`);
	}
	if (attempt.toolCalls.length > 0) {
		parts.push(`tools=${attempt.toolCalls.map((call) => call.name).join(",")}`);
	}
	return parts.join("; ");
}

/**
 * The **"failing-LLM list"** (§5.AB, Phase-2) — the PROJECTION of below-bar (model × role) cells from the ledger, so the
 * "which models don't suffice for this role" list is always *derived* from evidence, never a hand-curated list. Returns
 * only `not_recommended` pairings (enough samples + a low success rate), sorted worst-first, each with its dominant
 * failure mode (the "why"). `insufficient_data` pairings are deliberately excluded — too few samples is not a floor.
 */
export function buildFailingModelList(
	events: readonly AgentLedgerEvent[],
	thresholds: ModelCapabilityAdviceThresholds = {},
): ModelRoleAdvice[] {
	return buildModelCapabilityAdvice(events, thresholds)
		.perRole.filter((advice) => advice.verdict === "not_recommended")
		.sort(
			(left, right) =>
				left.successRate - right.successRate ||
				left.role.localeCompare(right.role) ||
				left.modelId.localeCompare(right.modelId),
		);
}

/**
 * Re-decompose trigger (todo §5.B — decomposition quality & the knowledge-expansion loop).
 *
 * WHAT: the pure decision "given the quality signals for a proposed decomposition, what corrective action does it
 * need?" — one of {@link RedecomposeAction} `accept | refine | split | merge | redo`, with the ordered *why* and the
 * specific subtask ids implicated. It composes the OUTPUTS of the existing decomposition gates (it does not re-derive
 * them): the structural shape from `validateSubtaskDag` (`decomposition-subtask-dag.ts` §5.B) plus injected semantic /
 * sizing / coverage signals, all as plain values.
 *
 * WHY: §5.B ships two decomposition gates that each *report* problems but neither decides what to *do* about them.
 *   - `validateSubtaskDag` (`decomposition-subtask-dag.ts`) collects EVERY structural defect (cycle / dangling dep /
 *     self-dep / disconnected island) + a shape summary (component count, roots, max depth). Its own header names the
 *     hole this module fills: *"Owed (wiring, separate): … feed the shape summary to a re-decompose trigger"*, and its
 *     `SubtaskDagReport` doc says the summary is *"what a re-decompose trigger reads to decide split/merge/redo"*.
 *   - `assessNKleinPlanTaskGraphQuality` (`nklein-agent/nklein-decomposition-graph-quality.ts`) reports semantic
 *     `violations` / `warnings` (test/docs/UI edges, reversed edges, sparsity).
 *   - `decideCardDecomposition` (`adaptive-decomposition-decision.ts` §5.AB) decides run-direct-vs-decompose for ONE
 *     card up front — the OPPOSITE direction (should we decompose at all), not "this decomposition already exists; is
 *     it good, and if not, split/merge/redo which parts".
 * There is no primitive that turns those reports into an *action verdict*. This is that missing trigger: the reactive
 * counterpart to the proactive granularity decision — after a decomposition exists, read its quality signals and pick
 * the least-disruptive corrective move.
 *
 * DESIGN — least disruption first, with a hard loop-safety cap (mirrors §5.B's `enforceRepeatedFailureTargetGuard`,
 * which parks a task after N repeated `decompose_project` failures rather than re-submitting forever, and the §5.B
 * rule "global re-decompose = last resort only"). Action priority (first firing wins):
 *   1. `redo`  — the decomposition is fundamentally unsound: a BLOCKING structural defect (a cycle / dangling dep —
 *                the graph can't even run), OR it fragmented the goal into disconnected islands, OR the children leave
 *                goal aspects uncovered. Start over. **But** if the re-decompose budget is exhausted this is DOWNGRADED
 *                (redo → refine, else accept) with `shouldHaltRedecomposition:true`, so a stubborn model can't loop.
 *   2. `split` — the structure is sound but one or more subtasks are TOO COARSE (over the sizing ceiling). Split those
 *                specific cards (returned in `oversizedSubtaskIds`); no need to redo the whole graph.
 *   3. `merge` — the structure is sound but the goal was OVER-decomposed into trivially-thin cards. Merge the
 *                undersized ones (`undersizedSubtaskIds`) so each card carries real work.
 *   4. `refine`— structurally sound and well-sized, but semantic concerns remain (reversed/missing edges, sparsity):
 *                targeted content/edge fixes, NOT a re-decompose.
 *   5. `accept`— no actionable signal; the decomposition is good enough to proceed.
 * Split outranks merge outranks refine because a too-coarse card is the more expensive failure (a weak model overloaded
 * past its chaining/synthesis ceiling — the §5.Z thesis) than a slightly-too-fine one, and both are more concrete than
 * a soft semantic warning.
 *
 * PURE / TOTAL / DETERMINISTIC: no I/O, no clock, no model, no mcp, no SDK types — same input ⇒ same
 * {@link RedecomposeTriggerVerdict}. All signals are INJECTED plain values (the caller runs the gates + the sizing
 * projection and hands their results in), so "given these quality signals, what should happen" is unit-testable with
 * no runtime. Inputs are never mutated. Mirrors the sibling verdict cores `retrieval-sufficiency.ts` (§5.AC) and
 * `delivery-decision.ts` — a typed verdict + ordered human-readable reasons.
 */

/** The corrective action a decomposition needs, coarse (most disruptive) → fine (none). */
export type RedecomposeAction =
	/** Fundamentally unsound (blocking structural defect / disconnected islands / uncovered goal) — decompose again from scratch. */
	| "redo"
	/** Structurally sound but some subtasks are too coarse — split the specific oversized cards. */
	| "split"
	/** Structurally sound but over-decomposed into trivially-thin cards — merge the undersized ones. */
	| "merge"
	/** Structurally sound and well-sized, but semantic concerns remain — targeted content/edge fixes, no re-decompose. */
	| "refine"
	/** No actionable signal — proceed with this decomposition. */
	| "accept";

/**
 * The per-subtask sizing facts the granularity rules read — a 1:1 projection of a decomposed card (an `NKleinPlanTask`
 * projects directly: `complexity`, `filesLikelyTouched.length`). Injected as a plain value so this core needs no SDK
 * import. A subtask is **oversized** when it breaches EITHER sizing ceiling (too coarse → split); **undersized** when
 * BOTH its complexity and file count sit at/under the "trivially thin" floors (over-decomposed → merge candidate).
 */
export interface SubtaskSizing {
	/** Subtask id (matches the ids in the structural report). */
	readonly id: string;
	/** Estimated complexity, 0–100 (same scale as the decomposition sizing contract). */
	readonly complexity: number;
	/** Number of files the subtask is likely to touch. */
	readonly likelyFileCount: number;
}

/**
 * The structural summary this trigger reads — the fields of `SubtaskDagReport` (`decomposition-subtask-dag.ts`) that
 * bear on the action decision. Passed as a plain value (project a `SubtaskDagReport` onto it) so this core does not
 * import the validator; the two stay independently composable.
 */
export interface DecompositionStructureSignals {
	/**
	 * A structural defect that makes the graph unrunnable exists — a `dependency_cycle`, `self_dependency`, or
	 * `unknown_dependency` from {@link "./decomposition-subtask-dag".SubtaskDagReport}. (A `disconnected_subtask` is a
	 * *fragmentation* smell, tracked separately via `disconnectedSubtaskCount`, not a blocker.) Forces `redo`.
	 */
	readonly hasBlockingStructuralDefect: boolean;
	/** Number of weakly-connected components (`SubtaskDagReport.componentCount`); > 1 ⇒ the goal fragmented into islands. */
	readonly componentCount: number;
	/** Number of subtasks with no edge in either direction (`SubtaskDagReport.disconnectedIds.length`). */
	readonly disconnectedSubtaskCount: number;
	/** Total subtasks in the decomposition (`SubtaskDagReport.subtaskCount`). */
	readonly subtaskCount: number;
}

/**
 * F1.1 — how many re-decompose rounds a task id encodes. The escalation ladder spawns follow-up decompose cards as
 * `redecompose-<parent>` (and a re-decomposed re-decompose nests the prefix), so the round count IS the graph-revision
 * count for the objective. Pure string projection — no store required.
 */
export function parseRedecomposeRound(taskId: string | null | undefined): number {
	let rounds = 0;
	let rest = taskId ?? "";
	while (rest.startsWith("redecompose-")) {
		rounds += 1;
		rest = rest.slice("redecompose-".length);
	}
	return rounds;
}

/** Everything the trigger needs. All fields are injected plain values produced by the upstream gates + projection. */
export interface RedecomposeTriggerInput {
	/** The structural shape (from `validateSubtaskDag`, projected onto {@link DecompositionStructureSignals}). */
	readonly structure: DecompositionStructureSignals;
	/** Per-subtask sizing facts (project each decomposed card). Order-independent; ids should match the structure. */
	readonly sizing: readonly SubtaskSizing[];
	/**
	 * Count of goal aspects the children DON'T cover — the completeness gap (e.g. from a coverage checker comparing the
	 * parent goal's required aspects against the union of the children). > 0 ⇒ the decomposition is incomplete ⇒ `redo`.
	 * Defaults to 0 (treat as complete) when the caller has no coverage signal.
	 */
	readonly uncoveredGoalAspectCount?: number;
	/**
	 * Count of HARD semantic violations (`assessNKleinPlanTaskGraphQuality().violations.length`) — actionable but not
	 * structure-breaking (a reversed/missing required edge). Drives `refine` when nothing more disruptive fired.
	 */
	readonly semanticViolationCount?: number;
	/**
	 * Count of SOFT semantic warnings (`assessNKleinPlanTaskGraphQuality().warnings.length`) — sparsity, isolated
	 * cards, likely-reversed edges. Contributes to `refine` (never forces a redo — these fire on valid graphs).
	 */
	readonly semanticWarningCount?: number;
	/**
	 * F1.1 — whether the ARCHITECT consulted knowledge tools (code search / repo map / architecture knowledge) before
	 * emitting this decomposition (from the knowledge-tool usage log / ledger attempt summary). `false` on a defective
	 * decomposition escalates `refine` → `redo`: the graph was drawn blind, so redrawing it WITH retrieval beats
	 * patching edges on guesses. `null`/omitted = unknown — never escalates.
	 */
	readonly consultedKnowledgeTools?: boolean | null;
	/**
	 * How many re-decompose attempts have ALREADY been spent on this task. Loop-safety: once it reaches
	 * `maxRedecomposeAttempts`, a would-be `redo` is downgraded and `shouldHaltRedecomposition` is set — the caller
	 * must stop re-decomposing and escalate (park / clarify / hand to a stronger model) instead of looping.
	 * Defaults to 0.
	 */
	readonly priorRedecomposeAttempts?: number;
}

/** Tunable thresholds — documented defaults aligned with the §5.B decomposition sizing contract; NOT measurement-validated. */
export interface RedecomposeTriggerOptions {
	/**
	 * Complexity above this marks a subtask TOO COARSE (→ split). Default 75 — the shipped `MAX_DECOMPOSED_TASK_COMPLEXITY`
	 * (`nklein-agent/decomposition/plan-task-schemas.ts`), the same ceiling the sizing contract already enforces per card.
	 */
	readonly maxSubtaskComplexity?: number;
	/**
	 * Likely-touched files above this marks a subtask TOO COARSE (→ split). Default 3 — the shipped
	 * `MAX_DECOMPOSED_TASK_LIKELY_FILES`; a card touching more than a few files is doing too much for one node.
	 */
	readonly maxSubtaskLikelyFiles?: number;
	/**
	 * Complexity at/below this is "trivially thin" (a merge SIGNAL, when paired with the file floor). Default 10 — a
	 * card this simple rarely justifies its own node + coordination edge; several of them ⇒ over-decomposed.
	 */
	readonly minSubtaskComplexity?: number;
	/**
	 * Likely-touched files at/below this is "trivially thin" (paired with the complexity floor). Default 1 — a card
	 * that barely touches one file alongside near-zero complexity is a merge candidate.
	 */
	readonly minSubtaskLikelyFiles?: number;
	/**
	 * Minimum number of undersized subtasks before `merge` fires. Default 2 — a single thin card is not worth
	 * re-decomposing; merging is only worthwhile once several thin cards could collapse together.
	 */
	readonly minUndersizedForMerge?: number;
	/**
	 * Loop-safety cap: at this many prior re-decompose attempts a would-be `redo` is downgraded (→ refine, else accept)
	 * and `shouldHaltRedecomposition` is set. Default 3 — mirrors the §5.B repeated-decomposition-failure guard
	 * (`enforceRepeatedFailureTargetGuard` parks after 4 consecutive failures), stopping one attempt short so the caller
	 * escalates rather than burning the last identical retry.
	 */
	readonly maxRedecomposeAttempts?: number;
}

/** The fully-resolved defaults (documented on {@link RedecomposeTriggerOptions}; aligned to the §5.B sizing contract). */
export const DEFAULT_REDECOMPOSE_TRIGGER_OPTIONS: Required<RedecomposeTriggerOptions> = {
	maxSubtaskComplexity: 75,
	maxSubtaskLikelyFiles: 3,
	minSubtaskComplexity: 10,
	minSubtaskLikelyFiles: 1,
	minUndersizedForMerge: 2,
	maxRedecomposeAttempts: 3,
};

/** The trigger verdict: the chosen action, the ordered why, the implicated subtask ids, and the loop-safety flag. */
export interface RedecomposeTriggerVerdict {
	/** The corrective action to take (see {@link RedecomposeAction}). */
	readonly action: RedecomposeAction;
	/**
	 * Human-readable reasons, most-significant first, for the chosen action — every actionable signal that was found
	 * (not only the one that decided the action), so the caller can surface the full picture. Empty only for `accept`.
	 */
	readonly reasons: readonly string[];
	/** Ids of subtasks that breached a sizing ceiling (the split targets). Sorted; empty unless splitting is relevant. */
	readonly oversizedSubtaskIds: readonly string[];
	/** Ids of trivially-thin subtasks (the merge candidates). Sorted; empty unless merging is relevant. */
	readonly undersizedSubtaskIds: readonly string[];
	/**
	 * TRUE when a re-decompose was warranted but the attempt budget is exhausted: the caller must STOP re-decomposing
	 * and escalate (park / clarify / stronger model) instead of looping. When set, `action` is the downgraded action
	 * (never `redo`).
	 */
	readonly shouldHaltRedecomposition: boolean;
}

/** Classify one subtask against the sizing thresholds. */
function classifySizing(
	subtask: SubtaskSizing,
	options: Required<RedecomposeTriggerOptions>,
): "oversized" | "undersized" | "ok" {
	if (subtask.complexity > options.maxSubtaskComplexity || subtask.likelyFileCount > options.maxSubtaskLikelyFiles) {
		return "oversized";
	}
	if (subtask.complexity <= options.minSubtaskComplexity && subtask.likelyFileCount <= options.minSubtaskLikelyFiles) {
		return "undersized";
	}
	return "ok";
}

/**
 * Decide the corrective action for a proposed decomposition from its quality signals — the §5.B re-decompose trigger.
 * Pure / total / deterministic; all inputs are injected plain values and are never mutated.
 *
 * Priority (first firing wins): `redo` (blocking defect / disconnected islands / uncovered goal — subject to the
 * loop-safety cap) → `split` (oversized cards) → `merge` (enough undersized cards) → `refine` (semantic concerns) →
 * `accept`. `reasons` lists EVERY actionable signal found (coverage → structure → sizing → semantic), most-significant
 * first, regardless of which one selected the action, so the caller sees the whole picture.
 */
export function decideRedecomposeTrigger(
	input: RedecomposeTriggerInput,
	options?: RedecomposeTriggerOptions,
): RedecomposeTriggerVerdict {
	const opts: Required<RedecomposeTriggerOptions> = { ...DEFAULT_REDECOMPOSE_TRIGGER_OPTIONS, ...options };

	const { structure } = input;
	const uncoveredGoalAspectCount = Math.max(0, input.uncoveredGoalAspectCount ?? 0);
	const semanticViolationCount = Math.max(0, input.semanticViolationCount ?? 0);
	const semanticWarningCount = Math.max(0, input.semanticWarningCount ?? 0);
	const priorRedecomposeAttempts = Math.max(0, input.priorRedecomposeAttempts ?? 0);
	const decomposedBlind = input.consultedKnowledgeTools === false;

	// ---- Sizing classification (drives split/merge, computed once). ----
	const oversized: string[] = [];
	const undersized: string[] = [];
	for (const subtask of input.sizing) {
		const verdict = classifySizing(subtask, opts);
		if (verdict === "oversized") {
			oversized.push(subtask.id);
		} else if (verdict === "undersized") {
			undersized.push(subtask.id);
		}
	}
	oversized.sort();
	undersized.sort();

	// ---- Collect the reasons for EVERY actionable signal, in significance order (coverage → structure → sizing → semantic). ----
	const reasons: string[] = [];
	const fragmentedIntoIslands = structure.subtaskCount > 1 && structure.componentCount > 1;

	if (uncoveredGoalAspectCount > 0) {
		reasons.push(
			`${uncoveredGoalAspectCount} goal aspect(s) are not covered by any child card — the decomposition is incomplete.`,
		);
	}
	if (structure.hasBlockingStructuralDefect) {
		reasons.push(
			"The dependency graph has a blocking structural defect (cycle / dangling or self dependency); it cannot run as-is.",
		);
	}
	if (fragmentedIntoIslands) {
		reasons.push(
			`The work fragmented into ${structure.componentCount} disconnected island(s) (${structure.disconnectedSubtaskCount} card(s) with no edge either way) — it likely needs an integrating card or a fresh decomposition.`,
		);
	}
	if (oversized.length > 0) {
		reasons.push(
			`${oversized.length} subtask(s) exceed the sizing ceiling (complexity > ${opts.maxSubtaskComplexity} or > ${opts.maxSubtaskLikelyFiles} files): ${oversized.join(", ")} — split them.`,
		);
	}
	if (undersized.length >= opts.minUndersizedForMerge) {
		reasons.push(
			`${undersized.length} subtask(s) are trivially thin (complexity ≤ ${opts.minSubtaskComplexity} and ≤ ${opts.minSubtaskLikelyFiles} file): ${undersized.join(", ")} — merge them so each card carries real work.`,
		);
	}
	if (semanticViolationCount > 0) {
		reasons.push(
			`${semanticViolationCount} semantic violation(s) (e.g. a required test/docs/dependency edge is missing or reversed) — fix the edges/content.`,
		);
	}
	if (semanticWarningCount > 0) {
		reasons.push(
			`${semanticWarningCount} semantic warning(s) (sparsity / isolated cards / likely-reversed edges) — review, though the graph may still be valid.`,
		);
	}
	const hasActionableDefect =
		uncoveredGoalAspectCount > 0 ||
		structure.hasBlockingStructuralDefect ||
		fragmentedIntoIslands ||
		oversized.length > 0 ||
		undersized.length >= opts.minUndersizedForMerge ||
		semanticViolationCount > 0 ||
		semanticWarningCount > 0;
	if (decomposedBlind && hasActionableDefect) {
		reasons.push(
			"The decomposition was produced WITHOUT consulting knowledge tools (no code search / repo map / architecture retrieval) — its defects likely stem from guessing at the codebase; re-decompose with retrieval first.",
		);
	}

	// ---- Decide the action by priority. `redo` first, subject to the loop-safety cap. ----
	const redoWarranted = structure.hasBlockingStructuralDefect || fragmentedIntoIslands || uncoveredGoalAspectCount > 0;

	if (redoWarranted) {
		if (priorRedecomposeAttempts >= opts.maxRedecomposeAttempts) {
			// Budget exhausted: do NOT loop. Downgrade to the best non-redo action and flag escalation.
			const downgraded: RedecomposeAction =
				oversized.length > 0
					? "split"
					: undersized.length >= opts.minUndersizedForMerge
						? "merge"
						: semanticViolationCount > 0 || semanticWarningCount > 0
							? "refine"
							: "accept";
			reasons.push(
				`Re-decompose budget exhausted (${priorRedecomposeAttempts} prior attempt(s) ≥ cap ${opts.maxRedecomposeAttempts}); not re-decomposing again — escalate (park / clarify / stronger model) instead of looping.`,
			);
			return {
				action: downgraded,
				reasons,
				oversizedSubtaskIds: oversized,
				undersizedSubtaskIds: undersized,
				shouldHaltRedecomposition: true,
			};
		}
		return {
			action: "redo",
			reasons,
			oversizedSubtaskIds: oversized,
			undersizedSubtaskIds: undersized,
			shouldHaltRedecomposition: false,
		};
	}

	if (oversized.length > 0) {
		return {
			action: "split",
			reasons,
			oversizedSubtaskIds: oversized,
			undersizedSubtaskIds: undersized,
			shouldHaltRedecomposition: false,
		};
	}

	if (undersized.length >= opts.minUndersizedForMerge) {
		return {
			action: "merge",
			reasons,
			oversizedSubtaskIds: oversized,
			undersizedSubtaskIds: undersized,
			shouldHaltRedecomposition: false,
		};
	}

	if (semanticViolationCount > 0 || semanticWarningCount > 0) {
		// F1.1: a BLIND decomposition with semantic defects is worth redoing WITH retrieval, not patching — the edges
		// were guessed, so refining them compounds the guess. The loop-safety cap stays authoritative: with the budget
		// exhausted the refine stands (never converts into another decompose round).
		if (decomposedBlind && priorRedecomposeAttempts < opts.maxRedecomposeAttempts) {
			return {
				action: "redo",
				reasons,
				oversizedSubtaskIds: oversized,
				undersizedSubtaskIds: undersized,
				shouldHaltRedecomposition: false,
			};
		}
		return {
			action: "refine",
			reasons,
			oversizedSubtaskIds: oversized,
			undersizedSubtaskIds: undersized,
			shouldHaltRedecomposition: false,
		};
	}

	return {
		action: "accept",
		reasons: [],
		oversizedSubtaskIds: oversized,
		undersizedSubtaskIds: undersized,
		shouldHaltRedecomposition: false,
	};
}

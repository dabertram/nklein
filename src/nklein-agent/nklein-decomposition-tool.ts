import type {
	RuntimeBoardCard,
	RuntimeBoardData,
	RuntimeBoardDependency,
	RuntimeTaskNKleinSettings,
} from "../core/api-contract";
import { recordSelfObservation } from "../telemetry/self-observation-sink";
import type { NKleinPlanTaskGraphQualityAssessment } from "./nklein-decomposition-graph-quality";
import type { NKleinPlanTaskGraph } from "./nklein-plan-artifacts";
import {
	nkleinPlanTaskGraphSchema,
	updateNKleinPlanArtifactApplicationStatus,
	writeNKleinPlanArtifacts,
} from "./nklein-plan-artifacts";
import type { NKleinTaskRoutingCandidate } from "./nklein-task-router";
import { repairJsonStringValue } from "./nklein-tool-argument-repair";
import type { AgentTool } from "./sdk-agent-types";

export {
	applyDecomposeProjectArtifactsToWorkspace,
	applyNKleinPlanTaskReplacementArtifacts,
	redactWorkspacePathForAgent,
	toWorkspaceRelativeArtifactPath,
} from "./decomposition/plan-artifact-apply";
export {
	applyNKleinPlanTaskGraphToBoard,
	collectBoardTaskIds,
	findGeneratedPlanTaskCard,
	replaceNKleinPlanTaskInGraph,
} from "./decomposition/plan-task-board-apply";
export {
	expandDecomposeProjectTasks,
	formatExpansionRevisionMarkdown,
	getReplacementBoundaryTaskIds,
	uniqStrings,
} from "./decomposition/plan-task-expansion";
export type { DecomposeProjectToolInput } from "./decomposition/plan-task-input-parse";
export {
	assertUsableDecomposeProjectInput,
	decomposeProjectFieldIsUsable,
	formatCompactSchemaIssues,
	normalizeDecomposeProjectToolInput,
	slugifyTaskId,
} from "./decomposition/plan-task-input-parse";
export {
	buildTaskPrompt,
	formatSharedPlanContext,
	truncateSharedContext,
} from "./decomposition/plan-task-prompt";
export {
	estimateTaskWallTimeMs,
	formatTaskModelFitEvidence,
	previewNKleinPlanTaskGraph,
	resolveTaskRoleSettings,
	selectTaskRoutingCandidate,
} from "./decomposition/plan-task-routing";
// Re-exports from submodules — all 6 external importers use this barrel and are untouched.
export {
	decomposeProjectExpansionsJsonSchema,
	decomposeProjectStringifiedExpansionsJsonSchema,
	decomposeProjectStringifiedTaskArrayJsonSchema,
	decomposeProjectTaskArrayJsonSchema,
	decomposeProjectTaskJsonSchema,
	decomposeProjectToolInputSchema,
	relaxJsonSchemaNode,
	toPermissiveAgentInputSchema,
} from "./decomposition/plan-task-schemas";
export {
	deriveOpenQuestionDefaults,
	normalizeTaskAcceptanceCommand,
	validateNKleinPlanTaskGraph,
	validatePlanQuestions,
	validateTaskGraphReferences,
	validateTaskSizingContract,
} from "./decomposition/plan-task-validation";

// ---------------------------------------------------------------------------
// Shared interfaces — these are the types all 6 importers depend on.
// They must stay here (in the barrel) so all importers get a stable module
// path. The submodules import these types from here via `../nklein-decomposition-tool`.
// ---------------------------------------------------------------------------

export interface NKleinPlanTaskSharedContext {
	spec?: string | null;
	decisionsMarkdown?: string | null;
}

export interface ApplyNKleinPlanTaskGraphInput {
	board: RuntimeBoardData;
	taskGraph: NKleinPlanTaskGraph;
	baseRef: string;
	randomUuid: () => string;
	sourceTaskId?: string | null;
	modelRoleSettings?: Record<string, RuntimeTaskNKleinSettings>;
	routingCandidates?: readonly NKleinTaskRoutingCandidate[];
	sharedContext?: NKleinPlanTaskSharedContext;
	/** OS power-mode multiplier for the autonomous timeout defaults (≥1; Low Power ≈ 2). Defaults to 1 (no scaling). */
	powerMultiplier?: number;
	now?: number;
}

export interface ApplyNKleinPlanTaskGraphResult {
	board: RuntimeBoardData;
	createdTasks: RuntimeBoardCard[];
	createdDependencies: RuntimeBoardDependency[];
	taskIdByPlanTaskId: Record<string, string>;
	rootTaskIds: string[];
	preview: NKleinPlanTaskGraphPreview;
	/**
	 * `dependsOn` edges removed to break a cycle in the architect's graph so the board has a startable root (absent
	 * when the graph was already acyclic). Surfaced for observability — a non-empty list flags a model that emitted a
	 * cyclic/over-constrained decomposition. See {@link breakDependencyCycles}.
	 */
	brokenDependencyEdges?: { taskId: string; dependsOnTaskId: string }[];
	/**
	 * Cycle clusters (SCCs of ≥2 tasks) that were condensed into sequential chains in emission order (§5.AV
	 * research correction: preserve the coupling the cycle expressed instead of tearing one edge and leaving the
	 * members spuriously unordered). Absent when no multi-task cycle existed.
	 */
	condensedCycleGroups?: string[][];
}

export interface ValidateNKleinPlanTaskGraphResult {
	taskGraph: NKleinPlanTaskGraph;
	taskCount: number;
	dependencyCount: number;
	quality: NKleinPlanTaskGraphQualityAssessment;
}

export interface ReplaceNKleinPlanTaskInGraphResult {
	taskGraph: NKleinPlanTaskGraph;
	replacementTaskIds: string[];
	entryTaskIds: string[];
	terminalTaskIds: string[];
}

export interface ApplyNKleinPlanTaskReplacementArtifactsResult extends ReplaceNKleinPlanTaskInGraphResult {
	taskGraphPath: string;
	revisionsPath: string;
}

export interface ApplyDecomposeProjectArtifactsResult {
	applied: boolean;
	createdTaskCount: number;
	createdDependencyCount: number;
	taskIdByPlanTaskId: Record<string, string>;
	rootTaskIds: string[];
	baseRef: string | null;
	message: string;
	preview: NKleinPlanTaskGraphPreview;
}

export interface NKleinDecompositionAppliedEvent {
	workspacePath: string;
	sourceTaskId: string | null;
	planSlug: string;
	rootTaskIds: string[];
	taskIdByPlanTaskId: Record<string, string>;
}

export type NKleinDecompositionAppliedHandler = (event: NKleinDecompositionAppliedEvent) => Promise<void> | void;

export interface NKleinPlanTaskEstimate {
	planTaskId: string;
	title: string;
	modelLabel: string;
	estimatedWallTimeMs: number | null;
}

export interface NKleinPlanTaskGraphPreview {
	taskCount: number;
	totalEstimatedWallTimeMs: number | null;
	tasks: NKleinPlanTaskEstimate[];
	summary: string;
}

// ---------------------------------------------------------------------------
// Tool factories — these stay in the barrel (the 3 functions named in the spec).
// ---------------------------------------------------------------------------

import type { SubtaskSizing } from "../core/decomposition-redecompose-trigger";
import { decideRedecomposeTrigger, parseRedecomposeRound } from "../core/decomposition-redecompose-trigger";
import type { DecomposedSubtask } from "../core/decomposition-subtask-dag";
import { validateSubtaskDag } from "../core/decomposition-subtask-dag";
import { decidePlanCritique } from "../core/plan-critique-decision";
import { formatHotFileWarnings } from "../core/work-package-card-shape";
import { didTaskConsultKnowledge } from "../telemetry/knowledge-tool-usage-stats";
import {
	createIncrementalDagSessionState,
	createIncrementalDagTools,
	type IncrementalDagSessionState,
	injectIncrementalTasksIntoDecomposeInput,
	resetIncrementalDagSessionState,
} from "./decomposition/incremental-dag-tools";
import {
	applyDecomposeProjectArtifactsToWorkspace,
	redactWorkspacePathForAgent,
	toWorkspaceRelativeArtifactPath,
} from "./decomposition/plan-artifact-apply";
import { formatExpansionRevisionMarkdown } from "./decomposition/plan-task-expansion";
import { normalizeDecomposeProjectToolInput } from "./decomposition/plan-task-input-parse";
import {
	decomposeProjectExpansionsJsonSchema,
	decomposeProjectStringifiedExpansionsJsonSchema,
	decomposeProjectStringifiedTaskArrayJsonSchema,
	decomposeProjectTaskArrayJsonSchema,
	toPermissiveAgentInputSchema,
} from "./decomposition/plan-task-schemas";
import { validateNKleinPlanTaskGraph } from "./decomposition/plan-task-validation";
import { selectBestNKleinPlanTaskGraph } from "./nklein-decomposition-selection";
import { runDecompositionClarificationPass, runModelBackedClarifyLoop } from "./nklein-plan-clarification";
import type { NKleinClarifyTurnHandler, NKleinPlanCritiqueRequestHandler } from "./nklein-plan-critique-tool";

function createDecomposeProjectTool(
	workspacePath: string,
	sourceTaskId?: string | null,
	onApplied?: NKleinDecompositionAppliedHandler,
	requestPlanCritique?: NKleinPlanCritiqueRequestHandler,
	requestClarifyTurn?: NKleinClarifyTurnHandler,
	incrementalState?: IncrementalDagSessionState,
): AgentTool {
	// W4.3: each plan slug gets AT MOST one diverse-critic round (revisions apply the feedback, never re-debate);
	// the per-run count budget lives in the service handler (it spans sessions).
	const critiquedSlugs = new Set<string>();
	// W2.7a (audit 2026-07-02): rejected-but-PARSEABLE graphs are stashed per plan slug; after the bounce budget
	// the BEST stashed candidate is applied instead of bouncing again — a weak model that keeps emitting
	// quality-violating graphs converges on its best attempt rather than spiraling into the repeated-call guard
	// ("recover in !Klein, don't teach the model"). A clean pass clears the stash.
	const rejectedGraphCandidatesBySlug = new Map<string, NKleinPlanTaskGraph[]>();
	const MAX_QUALITY_BOUNCES = 2;
	return {
		name: "decompose_project",
		description:
			"Validate and persist !Klein decomposition artifacts for a project-scale idea. Use this instead of editing .nklein/nklein plan files or tasks.json directly.",
		// The strict JSON Schema below documents the intended shape; toPermissiveAgentInputSchema relaxes it
		// (strips `required`, opens `additionalProperties`) so the SDK never pre-rejects a small model's call
		// before our handler can return a compact, recoverable error. See toPermissiveAgentInputSchema.
		inputSchema: toPermissiveAgentInputSchema({
			type: "object",
			properties: {
				slug: { type: "string", description: "Short stable plan slug, for example habit-insights." },
				spec: { type: "string", description: "Approved concise specification markdown, not a file path." },
				plan: { type: "string", description: "Implementation plan markdown." },
				summary: {
					type: "string",
					description:
						"Short plain-language summary for non-technical review: what will be built, the step count, and any assumptions.",
				},
				questions: {
					type: "array",
					description:
						"Clarifying questions considered before writing the plan. Open questions are rejected; record answered items or explicit assumed defaults.",
					items: {
						type: "object",
						properties: {
							id: { type: "string" },
							question: { type: "string" },
							status: { type: "string", enum: ["open", "answered", "assumed-default"] },
							options: {
								type: "array",
								items: {
									type: "object",
									properties: {
										id: { type: "string" },
										label: { type: "string" },
										description: { type: "string" },
										recommended: { type: "boolean" },
									},
									required: ["id", "label"],
									additionalProperties: false,
								},
							},
							answer: { type: ["string", "null"] },
							assumption: { type: ["string", "null"] },
						},
						required: ["id", "question", "status"],
						additionalProperties: false,
					},
				},
				title: { type: "string", description: "Project/task graph title." },
				tasks: {
					anyOf: [decomposeProjectTaskArrayJsonSchema, decomposeProjectStringifiedTaskArrayJsonSchema],
					description:
						"Task leaves. May be an array or a JSON-stringified array. !Klein adds schemaVersion, slug, title, validates dependencies, and writes artifacts. OMIT this field to submit the graph you built incrementally with add_task/add_dependency.",
				},
				defaultAcceptanceCommand: {
					type: "string",
					description: "Optional acceptance command applied to tasks that omit acceptanceCommand.",
				},
				minimumTaskCount: {
					type: "number",
					description:
						"Optional minimum number of terminal task leaves required after recursive expansions are applied. Use this when the request specifies a minimum such as at least ten tasks.",
				},
				expansions: {
					anyOf: [decomposeProjectExpansionsJsonSchema, decomposeProjectStringifiedExpansionsJsonSchema],
					description:
						"Optional recursive replacement map. May be an object or a JSON-stringified object. Keys are oversized task ids from tasks or another expansion; values are smaller replacement tasks. !Klein expands these before validation and rewrites dependencies to terminal replacement leaves.",
				},
			},
			required: ["slug", "spec", "plan", "title", "tasks"],
			additionalProperties: false,
		}),
		async execute(input) {
			// F1.7 incremental completion route: a call WITHOUT `tasks` submits the add_task/add_dependency
			// construction accumulated this session; an explicit `tasks` array is one-shot mode, unchanged.
			const effectiveInput = incrementalState
				? injectIncrementalTasksIntoDecomposeInput(input, incrementalState)
				: input;
			const { slug, spec, plan, summary, questions, taskGraph, expansions } =
				normalizeDecomposeProjectToolInput(effectiveInput);
			let validation: ReturnType<typeof validateNKleinPlanTaskGraph>;
			let appliedBestOfRejected = false;
			try {
				validation = validateNKleinPlanTaskGraph({ taskGraph, enforceGraphQuality: true });
				rejectedGraphCandidatesBySlug.delete(slug);
			} catch (qualityError) {
				// W2.7a: stash the parseable-but-violating graph; bounce within budget, else apply the BEST seen.
				const candidates = rejectedGraphCandidatesBySlug.get(slug) ?? [];
				candidates.push(taskGraph);
				rejectedGraphCandidatesBySlug.set(slug, candidates);
				if (candidates.length <= MAX_QUALITY_BOUNCES) {
					throw qualityError;
				}
				const best = selectBestNKleinPlanTaskGraph(candidates);
				if (!best.best) {
					throw qualityError;
				}
				// Structural validation only (no quality enforcement) — the graph parses/sizes; its coherence
				// warnings ride along and the §5.AV repair net (cycle-break) still applies downstream.
				validation = validateNKleinPlanTaskGraph({ taskGraph: best.best });
				appliedBestOfRejected = true;
				rejectedGraphCandidatesBySlug.delete(slug);
				await recordSelfObservation({
					signal: "custom",
					severity: "warning",
					message: `decompose_project applied the best of ${candidates.length} quality-rejected graphs for plan ${slug} after the bounce budget (fewest violations wins) instead of bouncing again.`,
					taskId: sourceTaskId ?? null,
					workspacePath,
					metadata: {
						operation: "decompose_project_best_of_rejected",
						planSlug: slug,
						candidateCount: candidates.length,
						bestIndex: best.bestIndex,
					},
				});
			}
			// F1.8: RED hot files (parallel writers with no dependency order) are surfaced as quality warnings and a
			// self-observation — record-only here; F1.9 enforces the boundary at dispatch/review.
			const hotFileWarnings = formatHotFileWarnings(taskGraph.hotFiles ?? []);
			if (hotFileWarnings.length > 0) {
				await recordSelfObservation({
					signal: "custom",
					severity: "warning",
					message: `decompose_project hot-file classification for plan ${slug}: ${hotFileWarnings.length} RED hot file(s)`,
					taskId: sourceTaskId ?? null,
					workspacePath,
					metadata: {
						operation: "decompose_project_hot_files",
						planSlug: slug,
						hotFiles: (taskGraph.hotFiles ?? []).map(
							(hotFile) => `${hotFile.classification}:${hotFile.path}:${hotFile.taskIds.join("+")}`,
						),
						warnings: hotFileWarnings,
					},
				});
			}
			if (validation.quality.warnings.length > 0) {
				await recordSelfObservation({
					signal: "custom",
					severity: "warning",
					message: `decompose_project graph-quality warnings for plan ${slug}`,
					taskId: sourceTaskId ?? null,
					workspacePath,
					metadata: {
						operation: "decompose_project_graph_quality",
						planSlug: slug,
						taskCount: validation.quality.taskCount,
						dependencyCount: validation.quality.dependencyCount,
						dependencyDensity: validation.quality.dependencyDensity,
						warnings: validation.quality.warnings,
					},
				});
			}
			// §5.B subtask-DAG structural gate + re-decompose trigger — RECORD-ONLY (observe, never bounce/reject).
			// The apply path above (validateNKleinPlanTaskGraph → writeNKleinPlanArtifacts → apply) is byte-identical;
			// this block only OBSERVES. It closes a real gap: `validateTaskGraphReferences` throws on the first
			// duplicate/unknown-dep it meets but has NO cycle detection, so a mutually-recursive pair (A→B→A) sails
			// through here silently (the §5.AV cycle-BREAK repair only runs later, inside board apply). `validateSubtaskDag`
			// runs full cycle/connectivity analysis on the SAME graph and `decideRedecomposeTrigger` turns its report
			// (plus the sizing projection + semantic counts) into a redo/split/merge/refine/accept verdict we log for
			// the operator. Nothing here changes control flow — a cyclic or coarse graph is recorded, then applied
			// exactly as before (measure first; a live architect-bounce is a separate, later increment).
			const subtaskDagInput: DecomposedSubtask[] = validation.taskGraph.tasks.map((task) => ({
				id: task.id,
				dependsOn: task.dependsOn,
				title: task.title,
			}));
			const subtaskDagReport = validateSubtaskDag(subtaskDagInput);
			// A blocking structural defect for the trigger = anything that makes the graph unrunnable (cycle / self-dep /
			// dangling dep). Duplicate ids never reach here (the schema/reference gate above throws first), so in practice
			// the only defect this live path surfaces is a dependency_cycle — the exact silent hole. `disconnected_subtask`
			// is a fragmentation smell, tracked via componentCount, NOT a blocker (mirrors the core's own split).
			const hasBlockingStructuralDefect = subtaskDagReport.defects.some(
				(defect) =>
					defect.kind === "dependency_cycle" ||
					defect.kind === "self_dependency" ||
					defect.kind === "unknown_dependency",
			);
			// Sizing projection: complexity + likely-file-count per card (an NKleinPlanTask projects 1:1). The hard sizing
			// gate above rejects complexity > 75 / > 3 files, so a truly oversized card never reaches this point; the
			// trigger runs a STRICTER advisory ceiling (60) to surface coarse-but-legal cards (approaching the hard limit)
			// as a split SIGNAL the binary reject can't give. Record-only ⇒ this never blocks a card the gate allowed.
			const subtaskSizing: SubtaskSizing[] = validation.taskGraph.tasks.map((task) => ({
				id: task.id,
				complexity: task.complexity,
				likelyFileCount: task.filesLikelyTouched.length,
			}));
			// F1.1: feed the LIVE knowledge signal into the trigger — did the architect consult knowledge tools
			// before emitting this decomposition (observation log, written per tool hook during the run)? — plus the
			// graph-revision count its own task id encodes (`redecompose-` rounds from the escalation ladder).
			const consultedKnowledgeTools = sourceTaskId
				? await didTaskConsultKnowledge(sourceTaskId).catch(() => null)
				: null;
			const redecomposeVerdict = decideRedecomposeTrigger(
				{
					structure: {
						hasBlockingStructuralDefect,
						componentCount: subtaskDagReport.componentCount,
						disconnectedSubtaskCount: subtaskDagReport.disconnectedIds.length,
						subtaskCount: subtaskDagReport.subtaskCount,
					},
					sizing: subtaskSizing,
					semanticViolationCount: validation.quality.violations.length,
					semanticWarningCount: validation.quality.warnings.length,
					consultedKnowledgeTools,
					priorRedecomposeAttempts: parseRedecomposeRound(sourceTaskId),
				},
				{ maxSubtaskComplexity: 60 },
			);
			// Only record when there is something actionable to say — a clean, accepted graph stays silent so the
			// telemetry (and the existing tests that count observations) is unchanged for the happy path.
			if (redecomposeVerdict.action !== "accept") {
				await recordSelfObservation({
					signal: hasBlockingStructuralDefect ? "decomposition_rejected" : "custom",
					severity: hasBlockingStructuralDefect ? "error" : "warning",
					message: `decompose_project subtask-DAG check for plan ${slug}: re-decompose trigger says ${redecomposeVerdict.action}${
						subtaskDagReport.cycles.length > 0
							? ` (dependency_cycle: ${subtaskDagReport.cycles.map((cycle) => cycle.join(" → ")).join("; ")})`
							: ""
					}${
						redecomposeVerdict.oversizedSubtaskIds.length > 0
							? ` (oversized: ${redecomposeVerdict.oversizedSubtaskIds.join(", ")})`
							: ""
					} — RECORD-ONLY, the plan still applies unchanged.`,
					taskId: sourceTaskId ?? null,
					workspacePath,
					metadata: {
						operation: "decompose_project_subtask_dag",
						planSlug: slug,
						action: redecomposeVerdict.action,
						consultedKnowledgeTools,
						priorRedecomposeAttempts: parseRedecomposeRound(sourceTaskId),
						hasBlockingStructuralDefect,
						defectKinds: subtaskDagReport.defects.map((defect) => defect.kind),
						cycles: subtaskDagReport.cycles.map((cycle) => [...cycle]),
						componentCount: subtaskDagReport.componentCount,
						disconnectedIds: [...subtaskDagReport.disconnectedIds],
						oversizedSubtaskIds: [...redecomposeVerdict.oversizedSubtaskIds],
						undersizedSubtaskIds: [...redecomposeVerdict.undersizedSubtaskIds],
						shouldHaltRedecomposition: redecomposeVerdict.shouldHaltRedecomposition,
						reasons: redecomposeVerdict.reasons,
					},
				});
			}
			// W4.3 decompose-critique (§5.AW): a HIGH-STAKES plan (big or coupled) whose structural quality is not
			// clean gets ONE lineage-diverse critic round BEFORE the cascade builds on it. "revise" rides the same
			// recoverable-bounce muscle as a quality violation — the architect's session applies the feedback and
			// calls decompose_project again (same slug ⇒ never re-critiqued ⇒ no loop). A critique can only ever
			// ADD one revision round; it never blocks (handler errors/null degrade to proceed).
			// Adversarial-review fixes (2026-07-02): NEVER critique the W2.7a best-of-rejected path — it is a
			// LAST-RESORT recovery for an architect that already proved it can't do better, and bouncing it again
			// feeds the repeated-decomposition-failure guard toward parking a decomposition that would otherwise
			// complete (the exact spiral the stash exists to prevent). Violations are summed with warnings for the
			// not-clean signal (violations can only reach this point via non-enforced validation).
			const critiqueDecision = decidePlanCritique({
				taskCount: validation.quality.taskCount,
				dependencyCount: validation.quality.dependencyCount,
				qualityWarningCount: validation.quality.warnings.length + validation.quality.violations.length,
				// The tool only knows whether an executor is wired; the REAL diverse-critic probe, budget, and
				// waiver surfacing live in the service handler (which returns null + records the waiver when no
				// diverse critic is loaded — a null never blocks).
				diverseCriticAvailable: Boolean(requestPlanCritique),
				critiqueBudgetRemaining: requestPlanCritique ? 1 : 0,
				alreadyCritiqued: critiquedSlugs.has(slug),
			});
			if (critiqueDecision.deliberate && requestPlanCritique && !appliedBestOfRejected) {
				critiquedSlugs.add(slug);
				const critique = await requestPlanCritique({
					slug,
					spec,
					tasks: validation.taskGraph.tasks.map((task) => ({
						id: task.id,
						title: task.title,
						dependsOn: task.dependsOn,
					})),
					qualityWarnings: validation.quality.warnings,
				}).catch(() => null);
				await recordSelfObservation({
					signal: "custom",
					severity: "info",
					message: critique
						? `Plan-critique round for ${slug}: the diverse critic said ${critique.verdict}${critique.verdict === "revise" ? " — bouncing the plan back to the architect with the feedback" : ""}.`
						: `Plan-critique round for ${slug} yielded no verdict (no diverse critic / budget spent / turn ended empty) — proceeding.`,
					taskId: sourceTaskId ?? null,
					workspacePath,
					metadata: {
						operation: "decompose_plan_critique",
						planSlug: slug,
						verdict: critique?.verdict ?? null,
						summary: critique?.summary ?? null,
					},
				});
				if (critique?.verdict === "revise" && critique.feedback) {
					throw new Error(
						`A second-opinion plan critic (a different model family) reviewed this decomposition and requested ONE revision before work starts. Apply this feedback and call decompose_project again with the REVISED plan (keep the same slug "${slug}"):\n${critique.feedback}`,
					);
				}
			}
			const artifacts = await writeNKleinPlanArtifacts({
				workspacePath,
				slug,
				spec,
				plan,
				summary,
				questions,
				revisions: formatExpansionRevisionMarkdown(expansions),
				taskGraph: validation.taskGraph,
				sourceTaskId,
			});
			const applied = await applyDecomposeProjectArtifactsToWorkspace({
				workspacePath,
				taskGraph: artifacts.taskGraph,
				sourceTaskId,
				sharedContext: {
					spec: artifacts.spec,
					decisionsMarkdown: artifacts.decisionsMarkdown,
				},
			});
			if (applied.applied) {
				// F1.3c: the deterministic question-quality pass — auto-resolve open questions whose default is safe
				// to adopt (recorded as assumed-default + a clarification_resolved revision); keep the risky ones open
				// for the operator / the model-backed loop. Best-effort: the pass never blocks a successful apply.
				try {
					const clarification = await runDecompositionClarificationPass({
						workspacePath,
						slug: artifacts.taskGraph.slug,
					});
					// F1.3e: for the questions the deterministic pass kept open, one bounded model-backed
					// auto-clarify loop (architect propose on its own model ↔ diverse §5.K review). Every degraded
					// path keeps the question open for the operator; the loop never blocks the apply.
					if (clarification.keptOpenCount > 0 && requestClarifyTurn) {
						const modelLoop = await runModelBackedClarifyLoop({
							workspacePath,
							slug: artifacts.taskGraph.slug,
							questionIds: clarification.openQuestionIds,
							requestClarifyTurn,
						}).catch(() => null);
						if (modelLoop) {
							clarification.assumedCount += modelLoop.resolvedCount;
							clarification.keptOpenCount = modelLoop.keptOpenIds.length;
							clarification.openQuestionIds = [...modelLoop.keptOpenIds];
						}
					}
					if (clarification.openQuestionCount > 0) {
						await recordSelfObservation({
							signal: "custom",
							severity: clarification.keptOpenCount > 0 ? "warning" : "info",
							message: `Decomposition clarification pass for plan ${artifacts.taskGraph.slug}: ${clarification.assumedCount}/${clarification.openQuestionCount} open question(s) auto-resolved with their safe default${
								clarification.flaggedCount > 0 ? ` (${clarification.flaggedCount} flagged for review)` : ""
							}${
								clarification.keptOpenCount > 0
									? `; ${clarification.keptOpenCount} kept open for the operator: ${clarification.openQuestionIds.join(", ")}`
									: ""
							}.`,
							taskId: sourceTaskId ?? null,
							workspacePath,
							metadata: {
								operation: "decompose_clarification_pass",
								planSlug: artifacts.taskGraph.slug,
								openQuestionCount: clarification.openQuestionCount,
								assumedCount: clarification.assumedCount,
								flaggedCount: clarification.flaggedCount,
								keptOpenCount: clarification.keptOpenCount,
								openQuestionIds: [...clarification.openQuestionIds],
							},
						});
					}
				} catch {
					// The clarification pass is advisory; a failure must never undo or block the applied decomposition.
				}
				await updateNKleinPlanArtifactApplicationStatus({
					workspacePath,
					slug: artifacts.taskGraph.slug,
					applicationStatus: "applied",
					sourceTaskId,
				});
				await onApplied?.({
					workspacePath,
					sourceTaskId: sourceTaskId ?? null,
					planSlug: artifacts.taskGraph.slug,
					rootTaskIds: applied.rootTaskIds,
					taskIdByPlanTaskId: applied.taskIdByPlanTaskId,
				});
			}
			if (incrementalState) {
				// The construction was consumed (or superseded by an explicit one-shot tasks array); a later
				// decomposition in the same session starts from a clean slate either way.
				resetIncrementalDagSessionState(incrementalState);
			}
			return {
				ok: true,
				artifactId: artifacts.artifactId,
				slug: artifacts.taskGraph.slug,
				taskCount: validation.taskCount,
				dependencyCount: validation.dependencyCount,
				graphQualityWarnings: [...validation.quality.warnings, ...hotFileWarnings],
				hotFiles: taskGraph.hotFiles ?? [],
				applied: applied.applied,
				createdTaskCount: applied.createdTaskCount,
				createdDependencyCount: applied.createdDependencyCount,
				taskIdByPlanTaskId: applied.taskIdByPlanTaskId,
				rootTaskIds: applied.rootTaskIds,
				preview: applied.preview,
				modelFitValidated: false,
				specPath: toWorkspaceRelativeArtifactPath(workspacePath, artifacts.specPath),
				planPath: toWorkspaceRelativeArtifactPath(workspacePath, artifacts.planPath),
				questionsPath: toWorkspaceRelativeArtifactPath(workspacePath, artifacts.questionsPath),
				decisionsPath: toWorkspaceRelativeArtifactPath(workspacePath, artifacts.decisionsPath),
				revisionsPath: toWorkspaceRelativeArtifactPath(workspacePath, artifacts.revisionsPath),
				summaryPath: toWorkspaceRelativeArtifactPath(workspacePath, artifacts.summaryPath),
				taskGraphPath: toWorkspaceRelativeArtifactPath(workspacePath, artifacts.taskGraphPath),
				instruction: applied.applied
					? `${redactWorkspacePathForAgent(workspacePath, applied.message)} Dry-run preview:\n${applied.preview.summary}\nSchema and sizing validation passed; connected local model fit will be enforced when each card starts. The artifact paths in this result are workspace-relative !Klein control-plane references (not files in your sandbox); do not try to inspect them with read_files, list_files, find_files, read_large_file, or run_commands. Stop this planning card now and continue by starting the newly created !Klein cards; do not implement this planning card directly.`
					: `Artifacts passed schema and sizing validation, but connected local model fit was not validated in this tool call. Dry-run preview:\n${applied.preview.summary}\n${redactWorkspacePathForAgent(workspacePath, applied.message)} Apply them through !Klein, not by editing task files: nklein task decompose --slug ${artifacts.taskGraph.slug}; connected-model fit is checked during apply/start.`,
			};
		},
	};
}

function createExpandTaskTool(): AgentTool {
	return {
		name: "expand_task",
		description:
			"Validate a recursively split replacement task graph for an oversized task. Prefer decompose_project.expansions for the final submission; use this only to check a replacement graph before submitting it.",
		inputSchema: {
			type: "object",
			properties: {
				taskGraph: { type: "object", description: "Replacement task graph with small executable leaves." },
			},
			required: ["taskGraph"],
			additionalProperties: false,
		},
		async execute(input) {
			const record = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
			// Small local models routinely stringify the nested graph object; recover it the same way
			// decompose_project recovers stringified `tasks`/`expansions` before schema validation.
			const taskGraph = nkleinPlanTaskGraphSchema.parse(repairJsonStringValue(record.taskGraph));
			const validation = validateNKleinPlanTaskGraph({ taskGraph });
			return {
				ok: true,
				taskGraph: validation.taskGraph,
				taskCount: validation.taskCount,
				dependencyCount: validation.dependencyCount,
				instruction:
					"Replacement graph passes the !Klein sizing contract. Connected-model fit is checked when the graph is applied. Put these replacement task leaves in decompose_project.expansions for the oversized task instead of editing plan artifacts directly.",
			};
		},
	};
}

export function createNKleinDecompositionTools(options: {
	workspacePath: string;
	artifactWorkspacePath?: string | null;
	sourceTaskId?: string | null;
	onApplied?: NKleinDecompositionAppliedHandler;
	/** W4.3: executes one diverse-critic round for a high-stakes plan; absent ⇒ the critique gate never fires. */
	requestPlanCritique?: NKleinPlanCritiqueRequestHandler;
	/** F1.3e: executes one bounded clarify turn; absent ⇒ kept-open questions go straight to the operator. */
	requestClarifyTurn?: NKleinClarifyTurnHandler;
}): AgentTool[] {
	// F1.7 (§5.AV): one incremental construction per session, shared by decompose_project (the completion route)
	// and the add_task/add_dependency tools below. One-shot mode (an explicit tasks array) is untouched.
	const incrementalState = createIncrementalDagSessionState();
	return [
		createDecomposeProjectTool(
			options.artifactWorkspacePath?.trim() || options.workspacePath,
			options.sourceTaskId,
			options.onApplied,
			options.requestPlanCritique,
			options.requestClarifyTurn,
			incrementalState,
		),
		createExpandTaskTool(),
		...createIncrementalDagTools(incrementalState),
	];
}

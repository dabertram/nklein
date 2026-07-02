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

function createDecomposeProjectTool(
	workspacePath: string,
	sourceTaskId?: string | null,
	onApplied?: NKleinDecompositionAppliedHandler,
): AgentTool {
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
						"Task leaves. May be an array or a JSON-stringified array. !Klein adds schemaVersion, slug, title, validates dependencies, and writes artifacts.",
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
			const { slug, spec, plan, summary, questions, taskGraph, expansions } =
				normalizeDecomposeProjectToolInput(input);
			let validation: ReturnType<typeof validateNKleinPlanTaskGraph>;
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
			return {
				ok: true,
				artifactId: artifacts.artifactId,
				slug: artifacts.taskGraph.slug,
				taskCount: validation.taskCount,
				dependencyCount: validation.dependencyCount,
				graphQualityWarnings: validation.quality.warnings,
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
}): AgentTool[] {
	return [
		createDecomposeProjectTool(
			options.artifactWorkspacePath?.trim() || options.workspacePath,
			options.sourceTaskId,
			options.onApplied,
		),
		createExpandTaskTool(),
	];
}

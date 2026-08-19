import { randomUUID } from "node:crypto";
import { relative, sep } from "node:path";
import { loadRuntimeConfig } from "../../config/runtime-config";
import { resolveFleetDecompositionSettings } from "../../config/runtime-config-fleet-decomposition-resolver";
import { DEFAULT_RUNTIME_FLEET_DECOMPOSITION_SETTINGS } from "../../core/api-contract";
import { resolveAutonomousTimeoutPowerMultiplier } from "../../core/autonomous-timeout-defaults";
import { assessPlannedTaskSizing, type ReviewCapacityEvidenceRow } from "../../core/review-capacity";
import { mutateWorkspaceState } from "../../state/workspace-state";
import { readSelfObservationEvents, recordSelfObservation } from "../../telemetry/self-observation-sink";
import type {
	ApplyDecomposeProjectArtifactsResult,
	ApplyNKleinPlanTaskReplacementArtifactsResult,
	NKleinPlanTaskSharedContext,
} from "../nklein-decomposition-tool";
import {
	appendNKleinPlanRevision,
	type NKleinPlanTask,
	type NKleinPlanTaskGraph,
	readNKleinPlanArtifacts,
	writeNKleinPlanTaskGraph,
} from "../nklein-plan-artifacts";
import type { NKleinTaskRoutingCandidate } from "../nklein-task-router";
import { buildDecompositionRoutingCandidates } from "./build-decomposition-routing-candidates";
import { applyNKleinPlanTaskGraphToBoard, replaceNKleinPlanTaskInGraph } from "./plan-task-board-apply";
import { buildPlanTaskFocusedSpans } from "./plan-task-focused-spans";
import { buildTaskPrompt } from "./plan-task-prompt";
import { derivePlanTaskRoutingSizing, previewNKleinPlanTaskGraphWithFallback } from "./plan-task-routing";

export { replaceNKleinPlanTaskInGraph };

/**
 * Relativize a host artifact path against the workspace root for agent-facing copy. Agents must never see
 * host details (AGENTS.md "agents must never see host details"): plan artifacts are written host-side under
 * `<workspace>/.nklein/nklein/plans/...`, so the absolute path is a host-mount leak. We surface the
 * workspace-relative POSIX path instead — which is also honest, since these trusted control-plane artifacts
 * live outside the agent's sandbox and are not meant to be read by the agent at all.
 */
export function toWorkspaceRelativeArtifactPath(workspacePath: string, absolutePath: string): string {
	return relative(workspacePath, absolutePath).split(sep).join("/");
}

/**
 * Strip the host workspace mount path out of agent-facing copy, leaving workspace-relative references. The
 * decompose apply path can surface an underlying error message (e.g. a git/filesystem failure) that embeds the
 * absolute host path; that message is interpolated into the agent-facing `instruction`, so it must be redacted
 * to honor "agents must never see host details" (AGENTS.md): host paths must not leak into error messages.
 */
export function redactWorkspacePathForAgent(workspacePath: string, text: string): string {
	if (!workspacePath) {
		return text;
	}
	// "<workspace>/sub/path" → "sub/path".
	const withoutPrefixed = text.split(`${workspacePath}${sep}`).join("");
	// A bare "<workspace>" → "." (the agent's sandbox root) — but ONLY when it stands alone (end of
	// string, whitespace, or a separator). Without the right-boundary a workspace path that is a PREFIX
	// of a sibling segment (e.g. "/ws" inside "/wsconfig.json" or "/ws-backup/a.ts") would be mangled to
	// ".config.json" / ".-backup/a.ts", corrupting unrelated paths in agent-facing error text.
	const escapedWorkspace = escapeForRegExp(workspacePath);
	const escapedSep = escapeForRegExp(sep);
	return withoutPrefixed.replace(new RegExp(`${escapedWorkspace}(?![^\\s${escapedSep}])`, "g"), ".");
}

/** Escape a literal string for safe interpolation into a `RegExp`. */
function escapeForRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function pluralizeCount(count: number, singular: string, plural = `${singular}s`): string {
	return `${count} ${count === 1 ? singular : plural}`;
}

/**
 * P21.6b slice 3 — OBSERVE-FIRST plan-time sizing: after a plan applies, record one sizing assessment per
 * created card (empirical review ceiling × empirical diff baseline × the routing's context sizing), keyed by
 * the BOARD task id so the card's later `review_capacity_evidence` row joins as predicted-vs-actual. Records
 * only — nothing enforces until that stream has judged the estimator. Fire-and-forget AFTER the workspace-state
 * transaction (never inside it — P24.1), and never allowed to fail the apply.
 */
async function recordPlanSizingObservations(input: {
	workspacePath: string;
	taskGraph: NKleinPlanTaskGraph;
	sharedContext?: NKleinPlanTaskSharedContext;
	sizingCandidates: readonly NKleinTaskRoutingCandidate[] | undefined;
	taskIdByPlanTaskId: Readonly<Record<string, string>>;
}): Promise<void> {
	const evidenceRows: ReviewCapacityEvidenceRow[] = (
		await readSelfObservationEvents({ category: "review_capacity_evidence", limit: 500 })
	).flatMap((record) => {
		const metadata = record.metadata as
			| { outcome?: unknown; diffLines?: unknown; reviewerModelId?: unknown }
			| undefined;
		const diffLines = Number(metadata?.diffLines);
		if (typeof metadata?.outcome !== "string" || !Number.isFinite(diffLines)) {
			return [];
		}
		return [
			{
				reviewerModelId: typeof metadata.reviewerModelId === "string" ? metadata.reviewerModelId : null,
				outcome: metadata.outcome,
				diffLines,
			},
		];
	});
	const largestContextWindow =
		input.sizingCandidates
			?.map((candidate) => candidate.entry.contextWindow.effective ?? 0)
			.filter((contextWindow) => contextWindow > 0)
			.sort((left, right) => right - left)[0] ?? null;
	for (const [planTaskId, boardTaskId] of Object.entries(input.taskIdByPlanTaskId)) {
		const task = input.taskGraph.tasks.find((candidate) => candidate.id === planTaskId);
		if (!task) {
			continue;
		}
		const sizing = derivePlanTaskRoutingSizing(
			task,
			buildTaskPrompt(task, input.sharedContext),
			input.sizingCandidates,
		);
		const assessment = assessPlannedTaskSizing({
			rows: evidenceRows,
			modelContextTokens: largestContextWindow,
			estimatedTaskTokens: sizing.fitBudgetTokens,
		});
		recordSelfObservation({
			signal: "custom",
			severity: "debug",
			message: `Plan sizing (observe-first) for ${boardTaskId}: ${
				assessment.verdict ? assessment.verdict.reason : `no verdict — ${assessment.basis}`
			}`,
			taskId: boardTaskId,
			workspacePath: input.workspacePath,
			metadata: {
				category: "plan_sizing_verdict",
				basis: assessment.basis,
				fits: assessment.verdict?.fits ?? null,
				binding: assessment.verdict?.binding ?? null,
				overshoot: assessment.verdict?.overshoot ?? null,
				mustSplit: assessment.verdict?.mustSplit ?? null,
				predictedDiffLines: assessment.estimatedDiffLines,
				reviewCeilingLines: assessment.reviewCeiling.ceilingLines,
				reviewCeilingSample: assessment.reviewCeiling.sample,
				reviewCeilingBasis: assessment.reviewCeiling.basis,
				estimatedTaskTokens: sizing.fitBudgetTokens,
				modelContextTokens: largestContextWindow,
				// 2026-08-19: 772 recorded assessments were ALL `no_evidence_at_all`, and the row could not say
				// why — "the estimator has no verdict yet" and "the estimator can never produce one" looked
				// identical. Name both denominators so a dark stream is legible from the evidence itself.
				evidenceRowCount: evidenceRows.length,
				attributedEvidenceRowCount: evidenceRows.filter((row) => row.reviewerModelId !== null).length,
				sizingCandidateCount: input.sizingCandidates?.length ?? 0,
			},
		});
	}
}

export async function applyDecomposeProjectArtifactsToWorkspace(input: {
	workspacePath: string;
	taskGraph: NKleinPlanTaskGraph;
	sourceTaskId?: string | null;
	sharedContext?: NKleinPlanTaskSharedContext;
}): Promise<ApplyDecomposeProjectArtifactsResult> {
	const runtimeConfig = await loadRuntimeConfig(input.workspacePath).catch(() => null);
	const powerMultiplier = await resolveAutonomousTimeoutPowerMultiplier();
	// §5.AB north-star: auto-discover routing candidates (the default model + every model currently LOADED on the
	// endpoint + any configured role) so each card is routed to the best-fit AVAILABLE model with NO manual role→model
	// config. Best-effort — an unresolvable provider yields undefined ⇒ deferred selection (today's behavior).
	const routingCandidates = runtimeConfig
		? await buildDecompositionRoutingCandidates(runtimeConfig).catch(() => undefined)
		: undefined;
	const fleetSizingCandidates = runtimeConfig
		? await buildDecompositionRoutingCandidates(runtimeConfig, { loadedOnly: true }).catch(() => [])
		: [];
	// Compute the fallback preview (shown on the not-applied return paths below, incl. the outer catch which depends on
	// this value) BEFORE the apply `try` — so it must not throw. The *-WithFallback helper degrades an all-infeasible
	// card to a candidate-less "model selected at start" preview instead of letting the model-feasibility guard escape
	// and fail the whole decompose. §5.AE live-wiring: the persisted skill-dynamics level threads through (absent config
	// ⇒ undefined ⇒ resolver default ⇒ byte-identical).
	const fallbackPreview = previewNKleinPlanTaskGraphWithFallback({
		taskGraph: input.taskGraph,
		routingCandidates,
		sharedContext: input.sharedContext,
		dynamicsLevel: runtimeConfig?.effectiveSkillDynamicsLevel,
	});
	if (runtimeConfig?.decompositionAutoApplyEnabled === false) {
		return {
			applied: false,
			createdTaskCount: 0,
			createdDependencyCount: 0,
			taskIdByPlanTaskId: {},
			rootTaskIds: [],
			baseRef: null,
			message: "Automatic card creation is disabled, so the task graph was kept pending for review.",
			preview: fallbackPreview,
		};
	}
	const focusedSpansByTaskId = await buildPlanTaskFocusedSpans({
		workspacePath: input.workspacePath,
		tasks: input.taskGraph.tasks,
	}).catch(() => ({}));
	try {
		const result = await mutateWorkspaceState<ApplyDecomposeProjectArtifactsResult>(input.workspacePath, (state) => {
			const baseRef = state.git.currentBranch ?? state.git.defaultBranch;
			if (!baseRef) {
				return {
					board: state.board,
					save: false,
					value: {
						applied: false,
						createdTaskCount: 0,
						createdDependencyCount: 0,
						taskIdByPlanTaskId: {},
						rootTaskIds: [],
						baseRef: null,
						message: "Could not determine a base branch, so the task graph was persisted but not applied.",
						preview: fallbackPreview,
					},
				};
			}
			const sourceCard = input.sourceTaskId
				? state.board.columns.flatMap((column) => column.cards).find((card) => card.id === input.sourceTaskId)
				: undefined;
			const fleetDecompositionSettings = resolveFleetDecompositionSettings({
				global: runtimeConfig?.fleetDecompositionDefaults ?? DEFAULT_RUNTIME_FLEET_DECOMPOSITION_SETTINGS,
				project: runtimeConfig?.fleetDecompositionOverride ?? null,
				task: sourceCard?.nkleinSettings?.fleetDecomposition ?? null,
			}).value;
			const applyInput = {
				board: state.board,
				taskGraph: input.taskGraph,
				baseRef,
				randomUuid: randomUUID,
				sourceTaskId: input.sourceTaskId,
				modelRoleSettings: runtimeConfig?.effectiveModelRoles,
				powerMultiplier,
				sharedContext: input.sharedContext,
				focusedSpansByTaskId,
				fleetSizingCandidates,
				fleetDecompositionSettings,
			};
			let applied: ReturnType<typeof applyNKleinPlanTaskGraphToBoard>;
			try {
				applied = applyNKleinPlanTaskGraphToBoard({ ...applyInput, routingCandidates });
			} catch {
				// A card was infeasible for EVERY available model — don't FAIL the decompose; defer that card's model
				// selection to card start (the prior behavior). Routing applies whenever all cards are feasible.
				applied = applyNKleinPlanTaskGraphToBoard(applyInput);
			}
			const brokenEdges = applied.brokenDependencyEdges ?? [];
			const condensedGroups = applied.condensedCycleGroups ?? [];
			const brokenEdgeList = brokenEdges.map((edge) => `${edge.taskId}⇸${edge.dependsOnTaskId}`).join(", ");
			const condensedList = condensedGroups.map((group) => group.join(" → ")).join("; ");
			// SCC-condense (§5.AV): a multi-task cycle is sequenced into a chain (the coupling the cycle expressed,
			// in emission order); anything else dropped is reported edge-by-edge so a cycle-emitting model is visible.
			const brokenEdgeNote =
				condensedGroups.length > 0
					? ` Sequenced ${pluralizeCount(condensedGroups.length, "dependency cycle")} into a chain so the board has a startable root (${condensedList}${brokenEdges.length > 0 ? `; dropped ${brokenEdgeList}` : ""}).`
					: brokenEdges.length > 0
						? ` Broke ${pluralizeCount(brokenEdges.length, "dependency cycle edge")} so the board has a startable root (${brokenEdgeList}).`
						: "";
			return {
				board: applied.board,
				value: {
					applied: true,
					createdTaskCount: applied.createdTasks.length,
					createdDependencyCount: applied.createdDependencies.length,
					taskIdByPlanTaskId: applied.taskIdByPlanTaskId,
					rootTaskIds: applied.rootTaskIds,
					baseRef,
					message: `Applied task graph to !Klein: created ${pluralizeCount(applied.createdTasks.length, "Planning card")} and ${pluralizeCount(applied.createdDependencies.length, "dependency", "dependencies")}.${brokenEdgeNote}`,
					preview: applied.preview,
				},
			};
		});
		if (result.value.applied) {
			// Observe-first sizing per created card — outside the state transaction, never load-bearing.
			void recordPlanSizingObservations({
				workspacePath: input.workspacePath,
				taskGraph: input.taskGraph,
				sharedContext: input.sharedContext,
				// `??` only falls back on null/undefined, and `buildDecompositionRoutingCandidates(…, loadedOnly)`
				// resolves to `[]` when the loaded-fleet probe finds nothing (or fails into its own `.catch(() => [])`).
				// An EMPTY list therefore silently defeated this fallback and the sizing assessment lost its context
				// window — recorded as "no evidence" rather than "the loaded probe returned nothing". Prefer the
				// loaded fleet when it HAS members; otherwise fall back to the full candidate set.
				sizingCandidates:
					fleetSizingCandidates && fleetSizingCandidates.length > 0 ? fleetSizingCandidates : routingCandidates,
				taskIdByPlanTaskId: result.value.taskIdByPlanTaskId,
			}).catch(() => undefined);
		}
		return result.value;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		await recordSelfObservation({
			signal: "runtime_error",
			severity: "warning",
			message: `Plan artifact auto-apply failed: ${message}`,
			taskId: input.sourceTaskId ?? null,
			workspacePath: input.workspacePath,
			metadata: {
				operation: "decompose_project_auto_apply",
				planSlug: input.taskGraph.slug,
				taskCount: input.taskGraph.tasks.length,
			},
		});
		return {
			applied: false,
			createdTaskCount: 0,
			createdDependencyCount: 0,
			taskIdByPlanTaskId: {},
			rootTaskIds: [],
			baseRef: null,
			message: `Could not apply the task graph automatically: ${message}`,
			preview: fallbackPreview,
		};
	}
}

export async function applyNKleinPlanTaskReplacementArtifacts(input: {
	workspacePath: string;
	slug: string;
	taskId: string;
	replacements: readonly NKleinPlanTask[];
	description?: string | null;
	evidence?: string | null;
	createdAt?: number;
	routingCandidates?: readonly NKleinTaskRoutingCandidate[];
}): Promise<ApplyNKleinPlanTaskReplacementArtifactsResult> {
	const artifacts = await readNKleinPlanArtifacts(input.workspacePath, input.slug);
	const replacement = replaceNKleinPlanTaskInGraph({
		taskGraph: artifacts.taskGraph,
		taskId: input.taskId,
		replacements: input.replacements,
		routingCandidates: input.routingCandidates,
	});
	const taskGraphPath = await writeNKleinPlanTaskGraph({
		workspacePath: input.workspacePath,
		slug: artifacts.taskGraph.slug,
		taskGraph: replacement.taskGraph,
	});
	const revisionsPath = await appendNKleinPlanRevision({
		workspacePath: input.workspacePath,
		slug: artifacts.taskGraph.slug,
		taskId: input.taskId,
		kind: "recursive_task_replaced",
		description:
			input.description?.trim() ||
			`Replaced ${input.taskId} with ${replacement.replacementTaskIds.join(", ")} and re-linked dependencies through entry/terminal replacement tasks.`,
		evidence:
			input.evidence?.trim() ||
			`Entry replacements: ${replacement.entryTaskIds.join(", ")}. Terminal replacements: ${replacement.terminalTaskIds.join(", ")}.`,
		createdAt: input.createdAt,
	});
	return {
		...replacement,
		taskGraphPath,
		revisionsPath,
	};
}

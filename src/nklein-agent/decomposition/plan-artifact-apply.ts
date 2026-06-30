import { randomUUID } from "node:crypto";
import { relative, sep } from "node:path";
import { loadRuntimeConfig } from "../../config/runtime-config";
import { resolveAutonomousTimeoutPowerMultiplier } from "../../core/autonomous-timeout-defaults";
import { mutateWorkspaceState } from "../../state/workspace-state";
import { recordSelfObservation } from "../../telemetry/self-observation-sink";
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
import { applyNKleinPlanTaskGraphToBoard, replaceNKleinPlanTaskInGraph } from "./plan-task-board-apply";
import { previewNKleinPlanTaskGraph } from "./plan-task-routing";

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
	// "<workspace>/sub/path" → "sub/path"; a bare "<workspace>" → "." (the agent's sandbox root).
	return text.split(`${workspacePath}${sep}`).join("").split(workspacePath).join(".");
}

function pluralizeCount(count: number, singular: string, plural = `${singular}s`): string {
	return `${count} ${count === 1 ? singular : plural}`;
}

export async function applyDecomposeProjectArtifactsToWorkspace(input: {
	workspacePath: string;
	taskGraph: NKleinPlanTaskGraph;
	sourceTaskId?: string | null;
	sharedContext?: NKleinPlanTaskSharedContext;
}): Promise<ApplyDecomposeProjectArtifactsResult> {
	const runtimeConfig = await loadRuntimeConfig(input.workspacePath).catch(() => null);
	const powerMultiplier = await resolveAutonomousTimeoutPowerMultiplier();
	const fallbackPreview = previewNKleinPlanTaskGraph({
		taskGraph: input.taskGraph,
		sharedContext: input.sharedContext,
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
			const applied = applyNKleinPlanTaskGraphToBoard({
				board: state.board,
				taskGraph: input.taskGraph,
				baseRef,
				randomUuid: randomUUID,
				sourceTaskId: input.sourceTaskId,
				modelRoleSettings: runtimeConfig?.effectiveModelRoles,
				powerMultiplier,
				sharedContext: input.sharedContext,
			});
			return {
				board: applied.board,
				value: {
					applied: true,
					createdTaskCount: applied.createdTasks.length,
					createdDependencyCount: applied.createdDependencies.length,
					taskIdByPlanTaskId: applied.taskIdByPlanTaskId,
					rootTaskIds: applied.rootTaskIds,
					baseRef,
					message: `Applied task graph to !Klein: created ${pluralizeCount(applied.createdTasks.length, "Planning card")} and ${pluralizeCount(applied.createdDependencies.length, "dependency", "dependencies")}.`,
					preview: applied.preview,
				},
			};
		});
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

import type { RuntimeWorkspaceStateResponse } from "../../core/api-contract";
import { type PlanGapKind, recordPlanGap } from "../../core/plan-gap";
import { appendNKleinPlanRevision } from "../../nklein-agent/nklein-plan-artifacts";
import { mutateWorkspaceState } from "../../state/workspace-state";
import {
	addPlanGapDecisionCardToBoard,
	addPlanGapIntegrationCardToBoard,
	addPlanGapScopeCardToBoard,
} from "./task-plan-gap-cards.js";
import { buildPlanGapAdaptationRevision, buildPlanGapIntegrationRevision } from "./task-plan-gap-prompts.js";
import { inferNKleinPlanSlugForTask } from "./task-plan-slug.js";
import { formatTaskRecord } from "./task-record-format.js";
import {
	createRuntimeTrpcClient,
	ensureRuntimeWorkspace,
	notifyRuntimeWorkspaceStateUpdated,
	resolveWorkspaceRepoPath,
} from "./task-runtime-workspace.js";

/**
 * The "record a plan gap" CLI command (§5.U-extracted from task.ts): record a plan-gap telemetry observation for a
 * task, append a cross-linking plan revision when the task belongs to a known plan, and for the card-creating gap kinds
 * (integration / decision / scope) add the companion Planning card. Leaf command — no dependency on the other commands.
 */

type JsonRecord = Record<string, unknown>;

export async function recordTaskPlanGapCommand(input: {
	cwd: string;
	projectPath?: string;
	taskId: string;
	kind: PlanGapKind;
	description: string;
	evidence?: string;
	planSlug?: string;
}): Promise<JsonRecord> {
	const workspaceRepoPath = await resolveWorkspaceRepoPath(input.projectPath, input.cwd);
	const planSlug =
		input.planSlug?.trim() ||
		(await inferNKleinPlanSlugForTask({
			workspacePath: workspaceRepoPath,
			taskId: input.taskId,
		}));
	recordPlanGap({
		workspacePath: workspaceRepoPath,
		taskId: input.taskId,
		kind: input.kind,
		description: input.description,
		evidence: input.evidence,
	});
	let revisionsPath = planSlug
		? await appendNKleinPlanRevision({
				workspacePath: workspaceRepoPath,
				slug: planSlug,
				taskId: input.taskId,
				kind: input.kind,
				description: input.description,
				evidence: input.evidence,
			})
		: null;
	let integrationTask: JsonRecord | null = null;
	let adaptationTask: JsonRecord | null = null;
	let adaptationCreated = false;
	if (input.kind === "integration_needed") {
		const workspaceId = await ensureRuntimeWorkspace(workspaceRepoPath);
		const runtimeClient = createRuntimeTrpcClient(workspaceId);
		const mutation = await mutateWorkspaceState<{ task: JsonRecord; created: boolean }>(
			workspaceRepoPath,
			(latestState) => {
				const baseRef = latestState.git.currentBranch ?? latestState.git.defaultBranch ?? "main";
				const created = addPlanGapIntegrationCardToBoard({
					state: latestState,
					taskId: input.taskId,
					description: input.description,
					evidence: input.evidence,
					baseRef,
				});
				const nextState: RuntimeWorkspaceStateResponse = {
					...latestState,
					board: created.board,
				};
				return {
					board: created.board,
					value: {
						task: formatTaskRecord(nextState, created.task, "planning"),
						created: created.created,
					},
				};
			},
		);
		integrationTask = mutation.value.task;
		adaptationTask = mutation.value.task;
		adaptationCreated = mutation.value.created;
		if (mutation.saved) {
			await notifyRuntimeWorkspaceStateUpdated(runtimeClient);
		}
		const integrationTaskId = typeof integrationTask.id === "string" ? integrationTask.id : null;
		if (integrationTaskId && planSlug && adaptationCreated) {
			const revision = buildPlanGapIntegrationRevision({
				taskId: input.taskId,
				integrationTaskId,
				description: input.description,
				evidence: input.evidence,
			});
			revisionsPath = await appendNKleinPlanRevision({
				workspacePath: workspaceRepoPath,
				slug: planSlug,
				taskId: input.taskId,
				kind: revision.kind,
				description: revision.description,
				evidence: revision.evidence ?? undefined,
			});
		}
	}
	if (
		input.kind === "missing_decision" ||
		input.kind === "contradictory_requirement" ||
		input.kind === "scope_too_large"
	) {
		const workspaceId = await ensureRuntimeWorkspace(workspaceRepoPath);
		const runtimeClient = createRuntimeTrpcClient(workspaceId);
		const mutation = await mutateWorkspaceState<{ task: JsonRecord; created: boolean }>(
			workspaceRepoPath,
			(latestState) => {
				const baseRef = latestState.git.currentBranch ?? latestState.git.defaultBranch ?? "main";
				const adapted =
					input.kind === "scope_too_large"
						? addPlanGapScopeCardToBoard({
								state: latestState,
								taskId: input.taskId,
								description: input.description,
								evidence: input.evidence,
								baseRef,
							})
						: addPlanGapDecisionCardToBoard({
								state: latestState,
								taskId: input.taskId,
								kind:
									input.kind === "contradictory_requirement"
										? "contradictory_requirement"
										: "missing_decision",
								description: input.description,
								evidence: input.evidence,
								baseRef,
							});
				const nextState: RuntimeWorkspaceStateResponse = {
					...latestState,
					board: adapted.board,
				};
				return {
					board: adapted.board,
					value: {
						task: formatTaskRecord(nextState, adapted.task, "planning"),
						created: adapted.created,
					},
				};
			},
		);
		adaptationTask = mutation.value.task;
		adaptationCreated = mutation.value.created;
		if (mutation.saved) {
			await notifyRuntimeWorkspaceStateUpdated(runtimeClient);
		}
		const adaptationTaskId = typeof adaptationTask.id === "string" ? adaptationTask.id : null;
		if (adaptationTaskId && planSlug && adaptationCreated) {
			const revision = buildPlanGapAdaptationRevision({
				taskId: input.taskId,
				adaptationTaskId,
				kind: input.kind,
				description: input.description,
				evidence: input.evidence,
			});
			revisionsPath = await appendNKleinPlanRevision({
				workspacePath: workspaceRepoPath,
				slug: planSlug,
				taskId: input.taskId,
				kind: revision.kind,
				description: revision.description,
				evidence: revision.evidence ?? undefined,
			});
		}
	}
	return {
		ok: true,
		workspacePath: workspaceRepoPath,
		taskId: input.taskId,
		kind: input.kind,
		description: input.description,
		planSlug,
		revisionsPath,
		integrationTask,
		adaptationTask,
		adaptationCreated,
	};
}

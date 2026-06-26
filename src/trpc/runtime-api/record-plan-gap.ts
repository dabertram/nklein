import {
	buildPlanGapAdaptationRevision,
	buildPlanGapIntegrationRevision,
} from "../../commands/task/task-plan-gap-prompts.js";
import {
	addPlanGapDecisionCardToBoard,
	addPlanGapIntegrationCardToBoard,
	addPlanGapScopeCardToBoard,
	inferNKleinPlanSlugForTask,
} from "../../commands/task.js";
import type {
	RuntimeBoardCard,
	RuntimeRecordNKleinPlanGapRequest,
	RuntimeRecordNKleinPlanGapResponse,
	RuntimeWorkspaceStateResponse,
} from "../../core/api-contract";
import { recordPlanGap } from "../../core/plan-gap";
import { appendNKleinPlanRevision } from "../../nklein-agent/nklein-plan-artifacts";
import { mutateWorkspaceState } from "../../state/workspace-state";
import type { RuntimeTrpcWorkspaceScope } from "../app-router";

/**
 * Handler for the record-plan-gap procedure, extracted from the oversized `runtime-api.ts`
 * (§5.X / architecture recommendation #3). It records a plan-gap telemetry observation, and for the card-creating
 * kinds adds a companion Planning card + cross-linking plan revision (observation-only kinds just append the
 * revision). A pure function of (workspaceScope, input) over module-level plan-gap helpers — no deps slice.
 * Behavior and wire contract are unchanged.
 */
export async function handleRecordNKleinPlanGap(
	workspaceScope: RuntimeTrpcWorkspaceScope,
	input: RuntimeRecordNKleinPlanGapRequest,
): Promise<RuntimeRecordNKleinPlanGapResponse> {
	// Record telemetry observation (fire-and-forget, non-throwing).
	recordPlanGap({
		workspacePath: workspaceScope.workspacePath,
		taskId: input.taskId,
		kind: input.kind,
		description: input.description,
		evidence: input.evidence,
	});

	// Append a plan revision if this task belongs to a known plan.
	const planSlug = await inferNKleinPlanSlugForTask({
		workspacePath: workspaceScope.workspacePath,
		taskId: input.taskId,
	});

	let workspaceState: RuntimeWorkspaceStateResponse | undefined;

	if (
		input.kind === "integration_needed" ||
		input.kind === "missing_decision" ||
		input.kind === "contradictory_requirement" ||
		input.kind === "scope_too_large"
	) {
		// These kinds create a companion Planning card.
		const mutation = await mutateWorkspaceState<{ adaptationTaskId: string | null; created: boolean }>(
			workspaceScope.workspacePath,
			(latestState) => {
				const baseRef = latestState.git.currentBranch ?? latestState.git.defaultBranch ?? "main";
				let adapted: {
					board: typeof latestState.board;
					task: RuntimeBoardCard;
					created: boolean;
				};
				if (input.kind === "integration_needed") {
					adapted = addPlanGapIntegrationCardToBoard({
						state: latestState,
						taskId: input.taskId,
						description: input.description,
						evidence: input.evidence,
						baseRef,
					});
				} else if (input.kind === "scope_too_large") {
					adapted = addPlanGapScopeCardToBoard({
						state: latestState,
						taskId: input.taskId,
						description: input.description,
						evidence: input.evidence,
						baseRef,
					});
				} else {
					// TypeScript can't infer that only missing_decision/contradictory_requirement
					// reach here; the outer if already excludes integration_needed and scope_too_large.
					const decisionKind = input.kind as Extract<
						typeof input.kind,
						"missing_decision" | "contradictory_requirement"
					>;
					adapted = addPlanGapDecisionCardToBoard({
						state: latestState,
						taskId: input.taskId,
						kind: decisionKind,
						description: input.description,
						evidence: input.evidence,
						baseRef,
					});
				}
				return {
					board: adapted.board,
					value: {
						adaptationTaskId: typeof adapted.task.id === "string" ? adapted.task.id : null,
						created: adapted.created,
					},
				};
			},
		);
		workspaceState = mutation.state;

		// Append a plan revision cross-linking the new card.
		if (planSlug && mutation.value.adaptationTaskId && mutation.value.created) {
			if (input.kind === "integration_needed") {
				const revision = buildPlanGapIntegrationRevision({
					taskId: input.taskId,
					integrationTaskId: mutation.value.adaptationTaskId,
					description: input.description,
					evidence: input.evidence,
				});
				await appendNKleinPlanRevision({
					workspacePath: workspaceScope.workspacePath,
					slug: planSlug,
					taskId: input.taskId,
					kind: revision.kind,
					description: revision.description,
					evidence: revision.evidence ?? undefined,
				});
			} else {
				const revision = buildPlanGapAdaptationRevision({
					taskId: input.taskId,
					adaptationTaskId: mutation.value.adaptationTaskId,
					kind: input.kind,
					description: input.description,
					evidence: input.evidence,
				});
				await appendNKleinPlanRevision({
					workspacePath: workspaceScope.workspacePath,
					slug: planSlug,
					taskId: input.taskId,
					kind: revision.kind,
					description: revision.description,
					evidence: revision.evidence ?? undefined,
				});
			}
		}
	} else if (planSlug) {
		// For observation-only kinds (missing_dependency, other): just append the revision.
		await appendNKleinPlanRevision({
			workspacePath: workspaceScope.workspacePath,
			slug: planSlug,
			taskId: input.taskId,
			kind: input.kind,
			description: input.description,
			evidence: input.evidence,
		});
	}

	const kindLabel: Record<string, string> = {
		missing_decision: "missing decision",
		contradictory_requirement: "contradictory requirement",
		missing_dependency: "missing dependency",
		scope_too_large: "scope too large",
		integration_needed: "integration needed",
		other: "other",
	};
	return {
		ok: true,
		taskId: input.taskId,
		kind: input.kind,
		message: `Recorded plan gap (${kindLabel[input.kind] ?? input.kind}) for task "${input.taskId}".`,
		workspaceState,
	};
}

import { randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import type { RuntimeConfigState } from "../../config/runtime-config";
import type {
	RuntimeNKleinPlanArtifactActionRequest,
	RuntimeNKleinPlanArtifactApplyResponse,
	RuntimeNKleinPlanArtifactRejectResponse,
} from "../../core/api-contract";
import { resolveAutonomousTimeoutPowerMultiplier } from "../../core/autonomous-timeout-defaults";
import { applyNKleinPlanTaskGraphToBoard } from "../../nklein-agent/nklein-decomposition-tool";
import {
	readNKleinPlanArtifactsByArtifactId,
	summarizeNKleinPlanArtifacts,
	updateNKleinPlanArtifactApplicationStatus,
} from "../../nklein-agent/nklein-plan-artifacts";
import { mutateWorkspaceState } from "../../state/workspace-state";
import type { RuntimeTrpcWorkspaceScope } from "../app-router";
import { findBoardCardById, findSourceCardBaseRef } from "../runtime-board-card-lookup";

/**
 * Apply a persisted plan artifact's task graph onto the board (the runtime-api `applyNKleinPlanArtifact`
 * procedure handler, extracted from the factory). The one factory dependency — the scoped runtime-config
 * loader (for model-role settings) — is passed in, so the lift is behavior-preserving. Rejects applying a
 * rejected artifact; resolves the base ref from the source card / git, mutates the board atomically, then
 * stamps the artifact "applied".
 */
export async function handleApplyNKleinPlanArtifact(
	workspaceScope: RuntimeTrpcWorkspaceScope,
	input: RuntimeNKleinPlanArtifactActionRequest,
	deps: { loadScopedRuntimeConfig: (scope: RuntimeTrpcWorkspaceScope) => Promise<RuntimeConfigState> },
): Promise<RuntimeNKleinPlanArtifactApplyResponse> {
	const artifacts = await readNKleinPlanArtifactsByArtifactId({
		workspacePath: workspaceScope.workspacePath,
		artifactId: input.artifactId,
	});
	if (artifacts.metadata.applicationStatus === "rejected") {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: "Rejected plan artifacts cannot be applied.",
		});
	}
	const runtimeConfig = await deps.loadScopedRuntimeConfig(workspaceScope).catch(() => null);
	const powerMultiplier = await resolveAutonomousTimeoutPowerMultiplier();
	const mutation = await mutateWorkspaceState(workspaceScope.workspacePath, (state) => {
		const cards = state.board.columns.flatMap((column) => column.cards);
		const baseRef =
			findSourceCardBaseRef(cards, artifacts.metadata.sourceTaskId) ??
			state.git.currentBranch ??
			state.git.defaultBranch;
		if (!baseRef) {
			throw new Error("Could not determine a base branch for applying the plan artifact.");
		}
		if (artifacts.metadata.sourceTaskId && !findBoardCardById(cards, artifacts.metadata.sourceTaskId)) {
			throw new Error(`Source card ${artifacts.metadata.sourceTaskId} was not found on this board.`);
		}
		const applied = applyNKleinPlanTaskGraphToBoard({
			board: state.board,
			taskGraph: artifacts.taskGraph,
			baseRef,
			randomUuid: randomUUID,
			sourceTaskId: artifacts.metadata.sourceTaskId,
			modelRoleSettings: runtimeConfig?.effectiveModelRoles,
			powerMultiplier,
			sharedContext: {
				spec: artifacts.spec,
				decisionsMarkdown: artifacts.decisionsMarkdown,
			},
		});
		return {
			board: applied.board,
			value: {
				createdTaskCount: applied.createdTasks.length,
				createdDependencyCount: applied.createdDependencies.length,
			},
		};
	});
	await updateNKleinPlanArtifactApplicationStatus({
		workspacePath: workspaceScope.workspacePath,
		slug: artifacts.taskGraph.slug,
		applicationStatus: "applied",
	});
	const updatedArtifacts = await readNKleinPlanArtifactsByArtifactId({
		workspacePath: workspaceScope.workspacePath,
		artifactId: input.artifactId,
	});
	return {
		ok: true,
		artifact: summarizeNKleinPlanArtifacts(updatedArtifacts),
		createdTaskCount: mutation.value.createdTaskCount,
		createdDependencyCount: mutation.value.createdDependencyCount,
		message: `Applied ${artifacts.taskGraph.title}: created ${mutation.value.createdTaskCount} cards and ${mutation.value.createdDependencyCount} dependencies.`,
		workspaceState: mutation.state,
	};
}

/**
 * Reject a persisted plan artifact (the runtime-api `rejectNKleinPlanArtifact` procedure handler). No
 * factory dependencies. Rejects rejecting an already-applied artifact; otherwise stamps it "rejected".
 */
export async function handleRejectNKleinPlanArtifact(
	workspaceScope: RuntimeTrpcWorkspaceScope,
	input: RuntimeNKleinPlanArtifactActionRequest,
): Promise<RuntimeNKleinPlanArtifactRejectResponse> {
	const artifacts = await readNKleinPlanArtifactsByArtifactId({
		workspacePath: workspaceScope.workspacePath,
		artifactId: input.artifactId,
	});
	if (artifacts.metadata.applicationStatus === "applied") {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: "Applied plan artifacts cannot be rejected.",
		});
	}
	await updateNKleinPlanArtifactApplicationStatus({
		workspacePath: workspaceScope.workspacePath,
		slug: artifacts.taskGraph.slug,
		applicationStatus: "rejected",
	});
	const updatedArtifacts = await readNKleinPlanArtifactsByArtifactId({
		workspacePath: workspaceScope.workspacePath,
		artifactId: input.artifactId,
	});
	return {
		ok: true,
		artifact: summarizeNKleinPlanArtifacts(updatedArtifacts),
		message: `Rejected ${artifacts.taskGraph.title}.`,
	};
}

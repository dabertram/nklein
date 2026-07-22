import { TRPCError } from "@trpc/server";
import type { RuntimeTaskAcceptanceVerifyRequest, RuntimeTaskAcceptanceVerifyResponse } from "../../core/api-contract";
import { ACCEPTANCE_RUN_CATEGORY } from "../../core/card-tracking-coverage";
import { cardVerificationFromAcceptance } from "../../core/delivery-evidence";
import { findBoardCardWithColumn } from "../../core/task-board-mutations";
import { recordCommunitySkillEffectivenessForTask } from "../../nklein-agent/community-skill-effectiveness-recorder";
import type { NKleinTaskSessionService } from "../../nklein-agent/nklein-task-session-service";
import { persistCardVerification } from "../../server/persist-card-verification";
import { loadWorkspaceState } from "../../state/workspace-state";
import { recordSelfObservation } from "../../telemetry/self-observation-sink";
import type { RuntimeTrpcWorkspaceScope } from "../app-router";
import { formatAcceptanceVerifyMessage } from "../runtime-task-message-formatting";

/**
 * Run a task's Acceptance check in its sandbox (the runtime-api `verifyTaskAcceptance` procedure
 * handler, extracted from the factory). The only factory dependency — the scoped task-session
 * service resolver — is passed in, so the lift is behavior-preserving. Throws NOT_FOUND when the task
 * is not on the board; otherwise returns the acceptance result with a user-facing message.
 */
export async function handleVerifyTaskAcceptance(
	workspaceScope: RuntimeTrpcWorkspaceScope,
	input: RuntimeTaskAcceptanceVerifyRequest,
	deps: {
		getScopedNKleinTaskSessionService: (scope: RuntimeTrpcWorkspaceScope) => Promise<NKleinTaskSessionService>;
		broadcastRuntimeWorkspaceStateUpdated?: (workspaceId: string, workspacePath: string) => Promise<void> | void;
	},
): Promise<RuntimeTaskAcceptanceVerifyResponse> {
	const state = await loadWorkspaceState(workspaceScope.workspacePath);
	const taskRecord = findBoardCardWithColumn(state.board, input.taskId);
	if (!taskRecord) {
		throw new TRPCError({
			code: "NOT_FOUND",
			message: `Task "${input.taskId}" was not found.`,
		});
	}
	const nkleinTaskSessionService = await deps.getScopedNKleinTaskSessionService(workspaceScope);
	const acceptance = await nkleinTaskSessionService.verifyTaskAcceptanceInSandbox({
		taskId: input.taskId,
		projectRepoPath: workspaceScope.workspacePath,
		baseRef: taskRecord.card.baseRef,
		taskPrompt: taskRecord.card.prompt,
		timeoutMs: input.timeoutMs,
	});
	if (typeof acceptance.passed === "boolean") {
		void recordCommunitySkillEffectivenessForTask({
			taskId: input.taskId,
			workspacePath: workspaceScope.workspacePath,
			passed: acceptance.passed,
		});
	}
	// F12.53: persist the snapshot onto the card so the badge + merge-warn read the newest REAL run. AWAITED, then
	// broadcast — fire-and-forget left the board (and the Commit/PR warn-gate reading it) permanently stale after
	// an on-demand Verify, so a known-red artifact could commit without the confirm (review-found critical).
	try {
		await persistCardVerification(
			workspaceScope.workspacePath,
			input.taskId,
			cardVerificationFromAcceptance(acceptance, Date.now()),
		);
		await deps.broadcastRuntimeWorkspaceStateUpdated?.(workspaceScope.workspaceId, workspaceScope.workspacePath);
	} catch {
		// Verification display must never break the check that produced it.
	}
	// N18: record that acceptance RAN, and what it concluded — on every path, not only the failing one.
	//
	// Before this, only failures emitted (`acceptance_setup_error`), so a card's trail could answer *"did
	// verification break?"* but never *"was this verified?"*. Those are different questions, and the second is the
	// one asked when deciding whether to trust a result. **A trail that records only failures makes a card that
	// was never verified look identical to one that passed** — silence reads as fine.
	//
	// `present` is carried separately from `passed` for the same reason: "no acceptance criteria existed" must not
	// be reported as a pass. Emitting at the RETURN means it fires for pass, fail and absent alike.
	try {
		recordSelfObservation({
			signal: "custom",
			severity: acceptance.passed === true ? "info" : "warning",
			message: `Acceptance verification ran for ${input.taskId}: ${formatAcceptanceVerifyMessage(acceptance)}`,
			taskId: input.taskId,
			metadata: {
				category: ACCEPTANCE_RUN_CATEGORY,
				present: acceptance.present ?? null,
				passed: acceptance.passed ?? null,
			},
		});
	} catch {
		// Telemetry must never break the check that produced it — same rule as the persistence above.
	}

	return {
		ok: acceptance.present === true && acceptance.passed === true,
		taskId: input.taskId,
		taskWorkspacePath: null,
		acceptance,
		message: formatAcceptanceVerifyMessage(acceptance),
	};
}

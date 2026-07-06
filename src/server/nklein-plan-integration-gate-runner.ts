import type { RuntimeBoardData, RuntimeCardReview } from "../core/api-contract";
import {
	findJustCompletedPlans,
	resolvePlanAcceptanceCommand,
	resolvePlanFailureSurfaceCardId,
} from "../core/plan-integration-gate";
import type { NKleinTaskSessionService } from "../nklein-agent/nklein-task-session-service";
import { mutateWorkspaceState } from "../state/workspace-state";
import { recordSelfObservation } from "../telemetry/self-observation-sink";
import type { RuntimeTrpcWorkspaceScope } from "../trpc/app-router";
import { applyCardReviewToBoard } from "./second-opinion-review-runner";
import { retryWorkspaceStateLock } from "./workspace-state-lock-retry";

/** Chars of the failing command's output surfaced on the parked review note (kept short — it lands on a card). */
const PLAN_GATE_OUTPUT_HEAD_BUDGET = 400;
/** The plan acceptance command runs on the fully-merged tree; project builds/tests can be slow, so allow 15 min. */
const PLAN_GATE_TIMEOUT_MS = 15 * 60 * 1000;

export interface PlanIntegrationGateRunnerDeps {
	warn: (message: string) => void;
}

export interface PlanIntegrationGateRunner {
	/**
	 * When the LAST non-terminal card of a decomposition completes, run the plan's project-level acceptance command
	 * against the fully-MERGED tree. Fire-and-forget: the (minutes-long) check must not delay releasing dependents.
	 */
	runForCompletion(
		scope: RuntimeTrpcWorkspaceScope,
		service: NKleinTaskSessionService,
		completedTaskId: string,
		board: RuntimeBoardData,
	): void;
}

/**
 * §5.U: the server-side plan-level integration gate (todo §5.0.5), lifted verbatim out of the `createRuntimeServer`
 * closure. Owns its per-server `completedPlanGateRunKeys` dedup set (one gate run per plan). Depends only on `warn`;
 * the task-session `service` is passed per-call so the sandbox acceptance runs against the caller's workspace.
 */
export function createPlanIntegrationGateRunner(deps: PlanIntegrationGateRunnerDeps): PlanIntegrationGateRunner {
	const completedPlanGateRunKeys = new Set<string>();

	const surfaceFailure = async (
		scope: RuntimeTrpcWorkspaceScope,
		planSlug: string,
		failure: { command: string; exitCode: number | null; outputHead: string },
	): Promise<void> => {
		let surfacedTaskId: string | null = null;
		await retryWorkspaceStateLock(() =>
			mutateWorkspaceState(scope.workspacePath, (latestState) => {
				const surfaceTaskId = resolvePlanFailureSurfaceCardId(latestState.board, planSlug);
				const surfaceCard = latestState.board.columns
					.flatMap((column) => column.cards)
					.find((card) => card.id === surfaceTaskId);
				if (!surfaceTaskId || !surfaceCard) {
					return { board: latestState.board, save: false, value: null };
				}
				surfacedTaskId = surfaceTaskId;
				const review: RuntimeCardReview = {
					status: "parked",
					round: surfaceCard.review?.round ?? 0,
					history: surfaceCard.review?.history ?? [],
					lastVerdict: "request_changes",
					lastSummary:
						`Plan-level integration gate FAILED for plan "${planSlug}": \`${failure.command}\` exited ` +
						`${failure.exitCode ?? "?"} on the fully-merged tree.`,
					lastFeedback: failure.outputHead || null,
					lastInsight: null,
					signOff: null,
					parkedReason:
						"Plan integration gate failed — every card passed in isolation but the merged tree does not. " +
						"Operator repair owed (v1 opens no repair cards; the re-decompose rung will own that).",
					updatedAt: Date.now(),
				};
				return {
					board: applyCardReviewToBoard(latestState.board, surfaceTaskId, review, "review"),
					value: null,
				};
			}),
		);
		if (surfacedTaskId) {
			deps.warn(
				`Plan integration gate FAILED for plan "${planSlug}" (exit ${failure.exitCode ?? "?"}): surfaced on card ${surfacedTaskId} in Review.`,
			);
		} else {
			deps.warn(
				`Plan integration gate FAILED for plan "${planSlug}" (exit ${failure.exitCode ?? "?"}), but no source/member card remains on the board to surface it on.`,
			);
		}
	};

	const runForCompletion = (
		scope: RuntimeTrpcWorkspaceScope,
		service: NKleinTaskSessionService,
		completedTaskId: string,
		board: RuntimeBoardData,
	): void => {
		for (const planSlug of findJustCompletedPlans({ board, completedTaskId })) {
			const gateKey = `${scope.workspaceId}:${planSlug}`;
			if (completedPlanGateRunKeys.has(gateKey)) {
				continue;
			}
			completedPlanGateRunKeys.add(gateKey);
			void (async () => {
				const command = resolvePlanAcceptanceCommand({ board, planSlug });
				if (!command) {
					deps.warn(
						`Plan integration gate skipped for plan "${planSlug}": no member card carries an acceptance command.`,
					);
					recordSelfObservation({
						signal: "custom",
						severity: "info",
						message: `Plan integration gate skipped for plan "${planSlug}": no acceptance command.`,
						workspacePath: scope.workspacePath,
						metadata: { category: "plan_integration_gate", planSlug, verdict: "skipped" },
					});
					return;
				}
				deps.warn(`Plan integration gate for plan "${planSlug}": running \`${command}\` on the merged tree.`);
				const acceptance = await service.verifyTaskAcceptanceInSandbox({
					taskId: `plan::${planSlug}`,
					projectRepoPath: scope.workspacePath,
					baseRef: "HEAD",
					taskPrompt: `Acceptance check: ${command}`,
					timeoutMs: PLAN_GATE_TIMEOUT_MS,
				});
				if (acceptance.passed === true) {
					deps.warn(`Plan integration gate PASSED for plan "${planSlug}": ${command}`);
					recordSelfObservation({
						signal: "custom",
						severity: "info",
						message: `Plan integration gate passed for plan "${planSlug}".`,
						workspacePath: scope.workspacePath,
						metadata: { category: "plan_integration_gate", planSlug, command, verdict: "pass" },
					});
					return;
				}
				const outputHead = acceptance.output.slice(0, PLAN_GATE_OUTPUT_HEAD_BUDGET);
				recordSelfObservation({
					signal: "verification_failed",
					severity: "error",
					message: `Plan integration gate FAILED for plan "${planSlug}": ${command}`,
					workspacePath: scope.workspacePath,
					metadata: {
						category: "plan_integration_gate",
						planSlug,
						command,
						verdict: "fail",
						exitCode: acceptance.exitCode,
						outputHead,
					},
				});
				await surfaceFailure(scope, planSlug, {
					command,
					exitCode: acceptance.exitCode,
					outputHead,
				});
			})().catch((error) => {
				// An ERRORED gate (sandbox down, lock storm) is not a pass — keep it loud, but don't park cards on
				// infrastructure noise: only a real FAIL of the command moves the source card to Review.
				const message = error instanceof Error ? error.message : String(error);
				deps.warn(`Plan integration gate errored for plan "${planSlug}" (result unknown — NOT a pass): ${message}`);
				recordSelfObservation({
					signal: "custom",
					severity: "warning",
					message: `Plan integration gate unavailable for plan "${planSlug}": ${message}`,
					workspacePath: scope.workspacePath,
					metadata: { category: "plan_integration_gate", planSlug, verdict: "unavailable" },
				});
			});
		}
	};

	return { runForCompletion };
}

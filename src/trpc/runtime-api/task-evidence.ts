import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { TRPCError } from "@trpc/server";
import type { RuntimeConfigState } from "../../config/runtime-config";
import type {
	RuntimeBoardCard,
	RuntimeTaskEvidenceResponse,
	RuntimeWorkspaceStateResponse,
} from "../../core/api-contract";
import { parseTaskEvidenceRequest } from "../../core/api-validation";
import { toErrorMessage } from "../../core/error-message";
import { resolveSpeculativeDeliveryTarget } from "../../core/speculative-delivery-target";
import { resolveTaskEvidenceCapture, shouldUsePersistedTaskResultArtifact } from "../../core/task-evidence-capture";
import type { NKleinTaskSessionService } from "../../nklein-agent/nklein-task-session-service";
import { loadWorkspaceState } from "../../state/workspace-state";
import { createEvidenceBundle } from "../../telemetry/evidence-bundle";
import { getWorkspaceChangesBetweenRefs } from "../../workspace/get-workspace-changes";
import { probeTaskResultBranchCommit, probeTaskResultEvidenceCommit } from "../../workspace/task-result-branches";
import type { RuntimeTrpcWorkspaceScope } from "../app-router";
import { buildTaskEvidencePromptBlock, renderWorkspaceChangesEvidence } from "./task-evidence-prompt.js";

const execFileAsync = promisify(execFile);

/**
 * Handler for the collect-task-evidence procedure, extracted from the oversized `runtime-api.ts`
 * (§5.X / architecture recommendation #3). It gathers a task's transcript, diff, and config snapshot into an
 * evidence bundle. Depends on a `{ getScopedNKleinTaskSessionService, loadScopedRuntimeConfig, getEvidenceBundleRoot }`
 * deps slice; the two local helpers `findTaskCard` + `resolveGitCommit` moved here with it (each was used only by this
 * handler). Behavior and wire contract are unchanged.
 */
export interface TaskEvidenceDeps {
	getScopedNKleinTaskSessionService: (scope: RuntimeTrpcWorkspaceScope) => Promise<NKleinTaskSessionService>;
	loadScopedRuntimeConfig: (scope: RuntimeTrpcWorkspaceScope) => Promise<RuntimeConfigState>;
	getEvidenceBundleRoot?: () => string;
}

function findTaskCard(board: RuntimeWorkspaceStateResponse["board"], taskId: string): RuntimeBoardCard | null {
	for (const column of board.columns) {
		const card = column.cards.find((candidate) => candidate.id === taskId);
		if (card) {
			return card;
		}
	}
	return null;
}

async function resolveGitCommit(cwd: string, ref: string): Promise<string | null> {
	try {
		const { stdout } = await execFileAsync("git", ["rev-parse", ref], {
			cwd,
			timeout: 5_000,
			maxBuffer: 128 * 1024,
		});
		const commit = stdout.trim();
		return commit || null;
	} catch {
		return null;
	}
}

function taskCaptureSummarySignature(summary: ReturnType<NKleinTaskSessionService["getSummary"]>): string {
	return JSON.stringify([
		summary?.state ?? null,
		summary?.updatedAt ?? null,
		summary?.lastHookAt ?? null,
		summary?.latestHookActivity?.hookEventName ?? null,
		summary?.latestHookActivity?.finalMessage ?? null,
	]);
}

/**
 * Read the session marker around the Git ref probe. Capture writes the ref before emitting its marker; if either side
 * changes during the probe, retry so evidence never combines a new marker with an old/missing ref observation.
 */
export async function readStableTaskCaptureSnapshot(input: {
	service: Pick<NKleinTaskSessionService, "getSummary">;
	taskId: string;
	repoPath: string;
	resultBranchTaskId: string;
	probeResultBranch?: typeof probeTaskResultBranchCommit;
}): Promise<{
	stable: boolean;
	summary: ReturnType<NKleinTaskSessionService["getSummary"]>;
	probe: Awaited<ReturnType<typeof probeTaskResultBranchCommit>>;
}> {
	const probeResultBranch = input.probeResultBranch ?? probeTaskResultBranchCommit;
	let latestSummary: ReturnType<NKleinTaskSessionService["getSummary"]> = null;
	let latestProbe: Awaited<ReturnType<typeof probeTaskResultBranchCommit>> = {
		status: "missing",
		commit: null,
	};
	for (let attempt = 0; attempt < 3; attempt += 1) {
		const before = input.service.getSummary(input.taskId);
		const probe = await probeResultBranch({
			repoPath: input.repoPath,
			taskId: input.resultBranchTaskId,
		});
		const after = input.service.getSummary(input.taskId);
		latestSummary = after;
		latestProbe = probe;
		if (taskCaptureSummarySignature(before) === taskCaptureSummarySignature(after)) {
			return { stable: true, summary: after, probe };
		}
	}
	return { stable: false, summary: latestSummary, probe: latestProbe };
}

export async function handleCollectTaskEvidence(
	workspaceScope: RuntimeTrpcWorkspaceScope | null,
	input: unknown,
	deps: TaskEvidenceDeps,
): Promise<RuntimeTaskEvidenceResponse> {
	if (!workspaceScope) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: "A workspace is required to collect task evidence.",
		});
	}
	const body = parseTaskEvidenceRequest(input);
	const state = await loadWorkspaceState(workspaceScope.workspacePath);
	const task = findTaskCard(state.board, body.taskId);
	if (!task) {
		throw new TRPCError({
			code: "NOT_FOUND",
			message: `Task ${body.taskId} was not found in this workspace.`,
		});
	}
	// Evidence is gathered from the project repo: a completed task's delta is its result branch (used for
	// changesResult below). An in-progress/no-capture task has no host-visible working tree — work runs in its
	// sandbox (worktrees retired, §5.A), so NEVER substitute the project's dirty host checkout for missing task evidence.
	const taskCwd = workspaceScope.workspacePath;
	const persistedArtifact = task.review?.resultArtifact ?? null;
	const { deliveredBranchTaskId: inferredResultBranchTaskId } = resolveSpeculativeDeliveryTarget({
		reviewDelivered: task.review?.status === "approved",
		reviewPreferred: null,
		persistedPreferred: task.review?.preferredCandidate,
		taskId: task.id,
	});
	const [nkleinTaskSessionService, runtimeConfig, baseCommit] = await Promise.all([
		deps.getScopedNKleinTaskSessionService(workspaceScope),
		deps.loadScopedRuntimeConfig(workspaceScope),
		resolveGitCommit(workspaceScope.workspacePath, task.baseRef),
	]);
	const liveSummary = nkleinTaskSessionService.getSummary(task.id);
	const usePersistedArtifact = Boolean(
		persistedArtifact &&
			shouldUsePersistedTaskResultArtifact({
				summary: liveSummary,
				resultCommit: persistedArtifact.resultCommit,
			}),
	);
	const resultBranchTaskId = usePersistedArtifact
		? (persistedArtifact?.resultBranchTaskId ?? inferredResultBranchTaskId)
		: inferredResultBranchTaskId;
	let capture: RuntimeTaskEvidenceResponse["capture"];
	if (persistedArtifact && usePersistedArtifact) {
		const evidenceProbe = await probeTaskResultEvidenceCommit({
			repoPath: workspaceScope.workspacePath,
			taskId: task.id,
		});
		capture =
			evidenceProbe.status === "found" && evidenceProbe.commit === persistedArtifact.resultCommit
				? {
						status: "result_branch",
						action: "inspect_result",
						message: "The exact artifact selected at delivery is pinned and included in this evidence bundle.",
						resultCommit: persistedArtifact.resultCommit,
						resultBranchTaskId,
					}
				: {
						status: "evidence_failed",
						action: "retry_evidence",
						message:
							evidenceProbe.status === "error"
								? `The pinned delivery artifact could not be inspected: ${evidenceProbe.message}`
								: "The persisted delivery receipt no longer matches its pinned Git evidence ref. Inspect repository diagnostics before retrying evidence collection.",
						resultCommit: null,
						resultBranchTaskId,
					};
	} else {
		const captureSnapshot = await readStableTaskCaptureSnapshot({
			service: nkleinTaskSessionService,
			taskId: task.id,
			repoPath: workspaceScope.workspacePath,
			resultBranchTaskId,
		});
		capture = captureSnapshot.stable
			? resolveTaskEvidenceCapture({
					summary: captureSnapshot.summary,
					resultCommit: captureSnapshot.probe.status === "found" ? captureSnapshot.probe.commit : null,
					resultProbeError: captureSnapshot.probe.status === "error" ? captureSnapshot.probe.message : null,
					resultBranchTaskId,
				})
			: {
					status: "capture_pending",
					action: "wait_for_capture",
					message:
						"The task capture changed repeatedly while evidence was collected. Wait for it to settle, then collect evidence again.",
					resultCommit: null,
					resultBranchTaskId,
				};
	}
	let changesResult = null;
	if (capture.status === "result_branch") {
		try {
			changesResult = await getWorkspaceChangesBetweenRefs({
				cwd: workspaceScope.workspacePath,
				// applyTaskPatchToResultBranch always creates one commit atop its immutable capture base. Never diff
				// against the moving branch name on the card: after merge it can hide or absorb unrelated changes.
				fromRef: `${capture.resultCommit}^`,
				toRef: capture.resultCommit,
			});
		} catch (error) {
			capture = {
				status: "diff_failed",
				action: "retry_evidence",
				message: `The task result branch exists, but its diff could not be assembled: ${toErrorMessage(error)}`,
				resultCommit: capture.resultCommit,
				resultBranchTaskId,
			};
		}
	}
	const messages = nkleinTaskSessionService.listMessages(task.id);
	const diffPatch = renderWorkspaceChangesEvidence(changesResult);
	const title = task.title?.trim() || task.id;
	const summaryText = [
		`Task: ${title} (${task.id})`,
		`Workspace: ${workspaceScope.workspacePath}`,
		`Task workspace: ${taskCwd}`,
		`Base ref: ${task.baseRef}`,
		`Base commit: ${baseCommit ?? "unknown"}`,
		`Capture status: ${capture.status}`,
		`Recommended action: ${capture.action}`,
		`Capture detail: ${capture.message}`,
		`Result branch task id: ${capture.resultBranchTaskId}`,
		`Result commit: ${capture.resultCommit ?? "none"}`,
		"",
		"Prompt:",
		task.prompt,
	].join("\n");
	const bundle = await createEvidenceBundle({
		rootDir: deps.getEvidenceBundleRoot?.(),
		scenario: `task-${task.id}-${title}`,
		outcome: task.autoReviewStatus === "failed" ? "failed" : "unknown",
		summary: summaryText,
		models: [
			task.nkleinSettings?.providerId && task.nkleinSettings?.modelId
				? `${task.nkleinSettings.providerId}/${task.nkleinSettings.modelId}`
				: "default",
		],
		metrics: [
			{ label: "changedFiles", value: changesResult?.files.length ?? 0 },
			{ label: "transcriptMessages", value: messages.length },
			{ label: "baseRef", value: task.baseRef },
			{ label: "baseCommit", value: baseCommit },
			{ label: "captureStatus", value: capture.status },
			{ label: "recommendedAction", value: capture.action },
			{ label: "resultBranchTaskId", value: capture.resultBranchTaskId },
			{ label: "resultCommit", value: capture.resultCommit },
		],
		transcripts: [
			{
				taskId: task.id,
				title,
				messages,
			},
		],
		diffPatch,
		configSnapshot: {
			task,
			runtimeConfig: {
				codeEmbeddingDefaults: runtimeConfig.codeEmbeddingDefaults,
				codeEmbeddingOverride: runtimeConfig.codeEmbeddingOverride,
				effectiveCodeEmbeddingSettings: runtimeConfig.effectiveCodeEmbeddingSettings,
				maxConcurrentTasks: runtimeConfig.maxConcurrentTasks,
				lostHeartbeatPolicy: runtimeConfig.lostHeartbeatPolicy,
			},
			workspacePath: workspaceScope.workspacePath,
			taskCwd,
			baseCommit,
			capture,
		},
	});
	return {
		bundlePath: bundle.bundlePath,
		summaryPath: bundle.summaryPath,
		capture,
		files: {
			...bundle.files,
			transcripts: [...bundle.files.transcripts],
		},
		summaryText,
		diffPatchText: diffPatch,
		promptBlock: buildTaskEvidencePromptBlock({
			task,
			workspacePath: workspaceScope.workspacePath,
			taskCwd,
			baseCommit,
			bundlePath: bundle.bundlePath,
			transcriptCount: messages.length > 0 ? 1 : 0,
			changeCount: changesResult?.files.length ?? 0,
			capture,
		}),
	};
}

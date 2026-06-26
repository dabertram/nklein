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
import type { NKleinTaskSessionService } from "../../nklein-sdk/nklein-task-session-service";
import { loadWorkspaceState } from "../../state/workspace-state";
import { createEvidenceBundle } from "../../telemetry/evidence-bundle";
import { getWorkspaceChanges, getWorkspaceChangesBetweenRefs } from "../../workspace/get-workspace-changes";
import { resolveTaskResultBranchCommit } from "../../workspace/task-result-branches";
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
	const taskResultCommit = await resolveTaskResultBranchCommit({
		repoPath: workspaceScope.workspacePath,
		taskId: task.id,
	});
	// Evidence is gathered from the project repo: a completed task's delta is its result branch (used for
	// changesResult below), and an in-progress task has no host-visible working tree — work runs in its
	// sandbox (worktrees retired, §5.A; the old fallback here would *create* a host worktree on miss).
	const taskCwd = workspaceScope.workspacePath;
	const [nkleinTaskSessionService, runtimeConfig, baseCommit, changesResult] = await Promise.all([
		deps.getScopedNKleinTaskSessionService(workspaceScope),
		deps.loadScopedRuntimeConfig(workspaceScope),
		resolveGitCommit(workspaceScope.workspacePath, task.baseRef),
		taskResultCommit
			? getWorkspaceChangesBetweenRefs({
					cwd: workspaceScope.workspacePath,
					fromRef: task.baseRef,
					toRef: taskResultCommit,
				}).catch(() => null)
			: getWorkspaceChanges(taskCwd)
					.then((changes) => changes)
					.catch(() => null),
	]);
	const messages = nkleinTaskSessionService.listMessages(task.id);
	const diffPatch = renderWorkspaceChangesEvidence(changesResult);
	const title = task.title?.trim() || task.id;
	const summaryText = [
		`Task: ${title} (${task.id})`,
		`Workspace: ${workspaceScope.workspacePath}`,
		`Task workspace: ${taskCwd}`,
		`Base ref: ${task.baseRef}`,
		`Base commit: ${baseCommit ?? "unknown"}`,
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
		},
	});
	return {
		bundlePath: bundle.bundlePath,
		summaryPath: bundle.summaryPath,
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
		}),
	};
}

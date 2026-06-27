import { loadRuntimeConfig } from "../../config/runtime-config";
import type { RuntimeTaskAcceptanceVerifyRequest, RuntimeTaskAcceptanceVerifyResponse } from "../../core/api-contract";
import { recordPlanGap } from "../../core/plan-gap";
import { buildNKleinAcceptanceRepairPlan } from "../../nklein-agent/nklein-acceptance-repair";
import { loadWorkspaceState } from "../../state/workspace-state";
import { classifyAcceptanceFailurePlanGap } from "./task-acceptance-plan-gap.js";
import { findTaskRecord, formatTaskRecord } from "./task-record-format.js";
import { createRuntimeTrpcClient, ensureRuntimeWorkspace, resolveWorkspaceRepoPath } from "./task-runtime-workspace.js";

/**
 * The "verify task acceptance" CLI command (§5.U-extracted from task.ts): run the task's acceptance check in its Docker
 * sandbox via the runtime, and on failure build a repair plan + classify/record any plan gap. Collaborators are
 * injectable (`VerifyTaskAcceptanceDependencies`) so the command is unit-testable without a live runtime.
 */

type JsonRecord = Record<string, unknown>;

interface RuntimeTaskAcceptanceVerifyMutationClient {
	runtime: {
		verifyTaskAcceptance: {
			mutate: (input: RuntimeTaskAcceptanceVerifyRequest) => Promise<RuntimeTaskAcceptanceVerifyResponse>;
		};
	};
}

interface VerifyTaskAcceptanceDependencies {
	resolveWorkspaceRepoPath?: typeof resolveWorkspaceRepoPath;
	loadWorkspaceState?: typeof loadWorkspaceState;
	ensureRuntimeWorkspace?: typeof ensureRuntimeWorkspace;
	createRuntimeTrpcClient?: (workspaceId: string | null) => RuntimeTaskAcceptanceVerifyMutationClient;
	loadRuntimeConfig?: typeof loadRuntimeConfig;
	recordPlanGap?: typeof recordPlanGap;
}

export async function runVerifyTaskAcceptanceCommand(
	input: {
		cwd: string;
		taskId: string;
		projectPath?: string;
		workspaceRoot?: boolean;
		ensureWorktree?: boolean;
		timeoutMs?: number;
		repairAttempt?: number;
		maxRepairAttempts?: number;
	},
	deps: VerifyTaskAcceptanceDependencies = {},
): Promise<JsonRecord> {
	const workspaceRepoPath = await (deps.resolveWorkspaceRepoPath ?? resolveWorkspaceRepoPath)(
		input.projectPath,
		input.cwd,
		{
			autoCreateIfMissing: false,
		},
	);
	const readState = deps.loadWorkspaceState ?? loadWorkspaceState;
	const state = await readState(workspaceRepoPath);
	const taskRecord = findTaskRecord(state, input.taskId);
	if (!taskRecord) {
		throw new Error(`Task "${input.taskId}" was not found in workspace ${workspaceRepoPath}.`);
	}

	// Acceptance always runs in the task's Docker sandbox via the runtime (the worktree-backed host gate is
	// retired, §5.A); `--workspace-root` referred to a host checkout that no longer exists.
	if (input.workspaceRoot) {
		throw new Error("--workspace-root is not available for sandboxed task verification.");
	}
	const workspaceId = await (deps.ensureRuntimeWorkspace ?? ensureRuntimeWorkspace)(workspaceRepoPath);
	const runtimeClient = (deps.createRuntimeTrpcClient ?? createRuntimeTrpcClient)(workspaceId);
	const response = await runtimeClient.runtime.verifyTaskAcceptance.mutate({
		taskId: input.taskId,
		...(input.ensureWorktree === true ? { ensureWorktree: true } : {}),
		...(input.timeoutMs ? { timeoutMs: input.timeoutMs } : {}),
	});
	const taskWorkspacePath: string | null = response.taskWorkspacePath;
	const result = response.acceptance;

	const ok = result.present === true && result.passed === true;
	const repair = ok
		? null
		: buildNKleinAcceptanceRepairPlan({
				taskId: input.taskId,
				taskTitle: taskRecord.task.title,
				taskPrompt: taskRecord.task.prompt,
				acceptance: result,
				attempt: input.repairAttempt ?? 1,
				maxAttempts: input.maxRepairAttempts,
				modelRoles: (await (deps.loadRuntimeConfig ?? loadRuntimeConfig)(workspaceRepoPath)).effectiveModelRoles,
			});
	const acceptancePlanGap = !ok
		? classifyAcceptanceFailurePlanGap({
				acceptancePresent: result.present,
				repairAction: repair?.action ?? null,
				command: result.command,
				output: result.output,
				taskPrompt: taskRecord.task.prompt,
			})
		: null;
	if (acceptancePlanGap) {
		(deps.recordPlanGap ?? recordPlanGap)({
			workspacePath: workspaceRepoPath,
			taskId: input.taskId,
			kind: acceptancePlanGap.kind,
			description: acceptancePlanGap.description,
			evidence: acceptancePlanGap.evidence,
		});
	}
	return {
		ok,
		workspacePath: workspaceRepoPath,
		taskWorkspacePath: taskWorkspacePath ?? (input.workspaceRoot ? workspaceRepoPath : null),
		task: formatTaskRecord(state, taskRecord.task, taskRecord.columnId),
		acceptance: result,
		...(repair ? { repair } : {}),
		...(ok
			? {}
			: {
					error: result.present
						? `Acceptance check failed for task "${input.taskId}".`
						: `Task "${input.taskId}" has no Acceptance check line.`,
				}),
	};
}

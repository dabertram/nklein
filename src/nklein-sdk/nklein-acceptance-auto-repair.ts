import { loadRuntimeConfig } from "../config/runtime-config";
import type { RuntimeTaskSessionSummary } from "../core/api-contract";
import { loadWorkspaceState } from "../state/workspace-state";
import { resolveTaskCwd } from "../workspace/task-worktree";
import type { runNKleinAcceptanceGate } from "./nklein-acceptance-gate";
import { buildNKleinAcceptanceRepairPlan } from "./nklein-acceptance-repair";
import type { NKleinTaskLaunchConfigOverrides, NKleinTaskSessionService } from "./nklein-task-session-service";

const DEFAULT_AUTO_REPAIR_MAX_ATTEMPTS = 2;

export type NKleinAcceptanceAutoRepairOutcome =
	| {
			type: "ready";
			reason: "passed" | "missing_acceptance" | "human_review";
	  }
	| {
			type: "repair_sent";
			action: "repair" | "escalate";
			attempt: number;
			maxAttempts: number;
	  }
	| {
			type: "skipped";
			reason: "task_not_found" | "worktree_unavailable" | "send_failed";
	  };

export interface NKleinAcceptanceAutoRepairAttemptStore {
	get(taskId: string): number | undefined;
	set(taskId: string, attempt: number): void;
	delete(taskId: string): void;
}

export interface RunNKleinAcceptanceAutoRepairInput {
	workspacePath: string;
	taskId: string;
	summary: RuntimeTaskSessionSummary;
	service: Pick<NKleinTaskSessionService, "sendTaskSessionInput"> &
		Partial<Pick<NKleinTaskSessionService, "verifyTaskAcceptanceInSandbox">>;
	attemptStore: NKleinAcceptanceAutoRepairAttemptStore;
	maxAttempts?: number;
	loadWorkspaceState?: typeof loadWorkspaceState;
	resolveTaskCwd?: typeof resolveTaskCwd;
	runAcceptanceGate?: typeof runNKleinAcceptanceGate;
	loadRuntimeConfig?: typeof loadRuntimeConfig;
}

function buildEscalationOverrides(
	settings: NonNullable<ReturnType<typeof buildNKleinAcceptanceRepairPlan>>["escalatedSettings"],
): NKleinTaskLaunchConfigOverrides | undefined {
	const providerId = settings?.providerId?.trim();
	const modelId = settings?.modelId?.trim();
	if (!providerId || !modelId) {
		return undefined;
	}
	return {
		providerId,
		modelId,
		...(settings?.reasoningEffort ? { reasoningEffort: settings.reasoningEffort } : {}),
	};
}

export async function runNKleinAcceptanceAutoRepair(
	input: RunNKleinAcceptanceAutoRepairInput,
): Promise<NKleinAcceptanceAutoRepairOutcome> {
	const readState = input.loadWorkspaceState ?? loadWorkspaceState;
	const state = await readState(input.workspacePath);
	const taskRecord = state.board.columns
		.flatMap((column) => column.cards.map((task) => ({ columnId: column.id, task })))
		.find((record) => record.task.id === input.taskId);
	if (!taskRecord) {
		input.attemptStore.delete(input.taskId);
		return { type: "skipped", reason: "task_not_found" };
	}

	const acceptance = input.runAcceptanceGate
		? await (async () => {
				const taskWorkspacePath = await (input.resolveTaskCwd ?? resolveTaskCwd)({
					cwd: input.workspacePath,
					taskId: input.taskId,
					baseRef: taskRecord.task.baseRef,
					ensure: false,
				}).catch(() => null);
				if (!taskWorkspacePath) {
					return null;
				}
				return await input.runAcceptanceGate?.({
					taskId: input.taskId,
					workspacePath: taskWorkspacePath,
					taskPrompt: taskRecord.task.prompt,
				});
			})()
		: input.service.verifyTaskAcceptanceInSandbox
			? await input.service.verifyTaskAcceptanceInSandbox({
					taskId: input.taskId,
					projectRepoPath: input.workspacePath,
					baseRef: taskRecord.task.baseRef,
					taskPrompt: taskRecord.task.prompt,
				})
			: null;
	if (!acceptance) {
		return { type: "skipped", reason: "worktree_unavailable" };
	}
	if (acceptance.present !== true) {
		input.attemptStore.delete(input.taskId);
		return { type: "ready", reason: "missing_acceptance" };
	}
	if (acceptance.passed === true) {
		input.attemptStore.delete(input.taskId);
		return { type: "ready", reason: "passed" };
	}

	const attempt = (input.attemptStore.get(input.taskId) ?? 0) + 1;
	input.attemptStore.set(input.taskId, attempt);
	const runtimeConfig = await (input.loadRuntimeConfig ?? loadRuntimeConfig)(input.workspacePath);
	const repairPlan = buildNKleinAcceptanceRepairPlan({
		taskId: input.taskId,
		taskTitle: taskRecord.task.title,
		taskPrompt: taskRecord.task.prompt,
		acceptance,
		attempt,
		maxAttempts: input.maxAttempts ?? DEFAULT_AUTO_REPAIR_MAX_ATTEMPTS,
		modelRoles: runtimeConfig.modelRoles,
	});
	if (!repairPlan || repairPlan.action === "human_review") {
		return { type: "ready", reason: "human_review" };
	}

	const nextSummary = await input.service.sendTaskSessionInput(
		input.taskId,
		repairPlan.prompt,
		input.summary.mode ?? undefined,
		undefined,
		repairPlan.action === "escalate" ? buildEscalationOverrides(repairPlan.escalatedSettings) : undefined,
	);
	if (!nextSummary) {
		return { type: "skipped", reason: "send_failed" };
	}
	return {
		type: "repair_sent",
		action: repairPlan.action,
		attempt: repairPlan.attempt,
		maxAttempts: repairPlan.maxAttempts,
	};
}

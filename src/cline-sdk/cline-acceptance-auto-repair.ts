import { loadRuntimeConfig } from "../config/runtime-config";
import type { RuntimeTaskSessionSummary } from "../core/api-contract";
import { loadWorkspaceState } from "../state/workspace-state";
import { resolveTaskCwd } from "../workspace/task-worktree";
import { runClineAcceptanceGate } from "./cline-acceptance-gate";
import { buildClineAcceptanceRepairPlan } from "./cline-acceptance-repair";
import type { ClineTaskLaunchConfigOverrides, ClineTaskSessionService } from "./cline-task-session-service";

const DEFAULT_AUTO_REPAIR_MAX_ATTEMPTS = 2;

export type ClineAcceptanceAutoRepairOutcome =
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

export interface ClineAcceptanceAutoRepairAttemptStore {
	get(taskId: string): number | undefined;
	set(taskId: string, attempt: number): void;
	delete(taskId: string): void;
}

export interface RunClineAcceptanceAutoRepairInput {
	workspacePath: string;
	taskId: string;
	summary: RuntimeTaskSessionSummary;
	service: Pick<ClineTaskSessionService, "sendTaskSessionInput">;
	attemptStore: ClineAcceptanceAutoRepairAttemptStore;
	maxAttempts?: number;
	loadWorkspaceState?: typeof loadWorkspaceState;
	resolveTaskCwd?: typeof resolveTaskCwd;
	runAcceptanceGate?: typeof runClineAcceptanceGate;
	loadRuntimeConfig?: typeof loadRuntimeConfig;
}

function buildEscalationOverrides(
	settings: NonNullable<ReturnType<typeof buildClineAcceptanceRepairPlan>>["escalatedSettings"],
): ClineTaskLaunchConfigOverrides | undefined {
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

export async function runClineAcceptanceAutoRepair(
	input: RunClineAcceptanceAutoRepairInput,
): Promise<ClineAcceptanceAutoRepairOutcome> {
	const readState = input.loadWorkspaceState ?? loadWorkspaceState;
	const state = await readState(input.workspacePath);
	const taskRecord = state.board.columns
		.flatMap((column) => column.cards.map((task) => ({ columnId: column.id, task })))
		.find((record) => record.task.id === input.taskId);
	if (!taskRecord) {
		input.attemptStore.delete(input.taskId);
		return { type: "skipped", reason: "task_not_found" };
	}

	const taskWorkspacePath = await (input.resolveTaskCwd ?? resolveTaskCwd)({
		cwd: input.workspacePath,
		taskId: input.taskId,
		baseRef: taskRecord.task.baseRef,
		ensure: false,
	}).catch(() => null);
	if (!taskWorkspacePath) {
		return { type: "skipped", reason: "worktree_unavailable" };
	}

	const acceptance = await (input.runAcceptanceGate ?? runClineAcceptanceGate)({
		taskId: input.taskId,
		workspacePath: taskWorkspacePath,
		taskPrompt: taskRecord.task.prompt,
	});
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
	const repairPlan = buildClineAcceptanceRepairPlan({
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

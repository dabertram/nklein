import { loadRuntimeConfig } from "../config/runtime-config";
import type { RuntimeTaskSessionSummary } from "../core/api-contract";
import { loadWorkspaceState } from "../state/workspace-state";
import { buildNKleinAcceptanceRepairPlan } from "./nklein-acceptance-repair";
import type { NKleinTaskLaunchConfigOverrides } from "./nklein-launch-config";
import type { NKleinTaskSessionService } from "./nklein-task-session-service";

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
			reason: "task_not_found" | "acceptance_unavailable" | "send_failed";
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

	// Acceptance always runs in the task's Docker sandbox (the worktree-backed host gate is retired, §5.A): the
	// scoped session service re-runs the acceptance command against the task's sandbox working copy.
	const acceptance = input.service.verifyTaskAcceptanceInSandbox
		? await input.service.verifyTaskAcceptanceInSandbox({
				taskId: input.taskId,
				projectRepoPath: input.workspacePath,
				baseRef: taskRecord.task.baseRef,
				taskPrompt: taskRecord.task.prompt,
			})
		: null;
	if (!acceptance) {
		return { type: "skipped", reason: "acceptance_unavailable" };
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

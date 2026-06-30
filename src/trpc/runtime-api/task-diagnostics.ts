import {
	buildTaskEscalationReport,
	type TaskEscalationReport,
	type TaskEscalationReportRequest,
} from "../../core/agent-attempt-ledger";
import type { RuntimeTaskDiagnosticsRequest, RuntimeTaskDiagnosticsResponse } from "../../core/api-contract";
import { readAllAgentLedger } from "../../state/agent-attempt-ledger-store";
import { readTaskRunSummaries } from "../../state/task-run-summary-store";
import { readSelfObservationEvents } from "../../telemetry/self-observation-sink";
import type { RuntimeTrpcWorkspaceScope } from "../app-router";

/**
 * Read a task's recent diagnostics — self-observation events + run summaries (the runtime-api
 * `getTaskDiagnostics` procedure handler, extracted from the factory). No factory dependencies.
 */
export async function handleGetTaskDiagnostics(
	workspaceScope: RuntimeTrpcWorkspaceScope,
	input: RuntimeTaskDiagnosticsRequest,
): Promise<RuntimeTaskDiagnosticsResponse> {
	const [events, runSummaries] = await Promise.all([
		readSelfObservationEvents({
			taskId: input.taskId,
			workspacePath: workspaceScope.workspacePath,
			limit: input.limit ?? 25,
		}),
		readTaskRunSummaries({
			taskId: input.taskId,
			workspacePath: workspaceScope.workspacePath,
			limit: input.limit ?? 25,
		}),
	]);
	return { ok: true, events, runSummaries };
}

/**
 * Build a task's escalation report from the agent-attempt ledger (the runtime-api `getTaskEscalation`
 * procedure handler). Workspace-agnostic — reads the global ledger.
 */
export async function handleGetTaskEscalation(input: TaskEscalationReportRequest): Promise<TaskEscalationReport> {
	return buildTaskEscalationReport(await readAllAgentLedger(), input.taskId);
}

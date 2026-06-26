import type {
	RuntimeKnowledgeToolUsageStatsResponse,
	RuntimeModelPerformanceStatsResponse,
	RuntimeRunUpdateResponse,
	RuntimeUpdateStatusResponse,
} from "../../core/api-contract";
import { readKnowledgeToolUsageStats } from "../../telemetry/knowledge-tool-usage-stats";
import { readModelPerformanceStats } from "../../telemetry/model-performance-stats";
import type { RuntimeTrpcWorkspaceScope } from "../app-router";

/**
 * Handlers for the update-status and runtime-stats procedures, extracted from the oversized `runtime-api.ts`
 * (§5.X / architecture recommendation #3). These are read-only, stateless observability endpoints with no
 * dependency on session, chat, or git state, making them the lowest-risk domain for the initial router
 * extraction.
 *
 * All four functions are thin adapters: they accept the minimal `deps` slice they need, keeping the same
 * behavior and wire contract as before.
 */

export interface UpdateStatusDeps {
	getUpdateStatus: () => RuntimeUpdateStatusResponse;
	runUpdateNow: () => Promise<RuntimeRunUpdateResponse>;
}

export async function handleGetUpdateStatus(deps: UpdateStatusDeps): Promise<RuntimeUpdateStatusResponse> {
	return deps.getUpdateStatus();
}

export async function handleRunUpdateNow(deps: UpdateStatusDeps): Promise<RuntimeRunUpdateResponse> {
	return await deps.runUpdateNow();
}

export async function handleGetModelPerformanceStats(
	workspaceScope: RuntimeTrpcWorkspaceScope | null,
): Promise<RuntimeModelPerformanceStatsResponse> {
	return await readModelPerformanceStats({
		workspacePath: workspaceScope?.workspacePath ?? null,
	});
}

export async function handleGetKnowledgeToolUsageStats(
	workspaceScope: RuntimeTrpcWorkspaceScope | null,
): Promise<RuntimeKnowledgeToolUsageStatsResponse> {
	return await readKnowledgeToolUsageStats({
		workspacePath: workspaceScope?.workspacePath ?? null,
	});
}

// F12.58 — the per-card effort read: fold the workspace's persisted task-run summaries through
// `computeCardEffort` and answer with THIS card's meter + the board totals. Read-only; a missing store or legacy
// runtime answers zeros rather than failing the panel.
import { computeCardEffort } from "../../core/card-effort";
import type { RuntimeCardEffortRequest, RuntimeCardEffortResponse } from "../../core/task-lifecycle-api-contract";
import { readTaskRunSummaries } from "../../state/task-run-summary-store";
import type { RuntimeTrpcWorkspaceScope } from "../app-router";

export async function handleGetCardEffort(
	workspaceScope: RuntimeTrpcWorkspaceScope | null,
	input: RuntimeCardEffortRequest,
): Promise<RuntimeCardEffortResponse> {
	if (!workspaceScope?.workspacePath) {
		return { card: null, boardTotalTokens: 0, boardWallMs: 0, boardUntrackedRuns: 0 };
	}
	const records = await readTaskRunSummaries({ workspacePath: workspaceScope.workspacePath, limit: 10_000 }).catch(
		() => [],
	);
	const rollup = computeCardEffort(
		records.map((record) => ({
			taskId: record.taskId,
			startedAt: record.startedAt,
			endedAt: record.endedAt,
			promptTokens: record.promptTokens,
			completionTokens: record.completionTokens,
			totalTokens: record.totalTokens,
			modelId: record.modelId,
		})),
	);
	const card = rollup.cards.find((entry) => entry.taskId === input.taskId) ?? null;
	return {
		card: card
			? {
					runs: card.runs,
					totalTokens: card.totalTokens,
					promptTokens: card.promptTokens,
					completionTokens: card.completionTokens,
					untrackedRuns: card.untrackedRuns,
					wallMs: card.wallMs,
				}
			: null,
		boardTotalTokens: rollup.boardTotalTokens,
		boardWallMs: rollup.boardWallMs,
		boardUntrackedRuns: rollup.boardUntrackedRuns,
	};
}

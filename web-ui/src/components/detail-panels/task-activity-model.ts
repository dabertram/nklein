import type { RuntimeTaskDiagnosticEvent, RuntimeTaskSessionSummary } from "@/runtime/types";
import type { CardSelection } from "@/types";

/**
 * Pure model + formatters for the card detail view's "task activity" surface, extracted from the oversized
 * `card-detail-view.tsx` (todo §5.U). `buildTaskActivitySteps` turns a card selection + session summary + recent
 * diagnostic events into the ordered Planning→Routing→Context→Retrieval→Tools→Acceptance→Merge step model the surface
 * renders; the rest are the tone/label/detail formatters it composes. No JSX, no React — pure functions.
 */

export interface TaskActivityStep {
	label: string;
	status: string;
	detail: string;
	tone: "active" | "done" | "waiting" | "issue" | "muted";
}

export function formatDiagnosticTime(createdAt: number): string {
	if (!Number.isFinite(createdAt)) {
		return "unknown";
	}
	return new Date(createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function getDiagnosticEventTone(event: RuntimeTaskDiagnosticEvent | null): TaskActivityStep["tone"] {
	if (!event) {
		return "muted";
	}
	if (event.severity === "error") {
		return "issue";
	}
	if (event.severity === "warning") {
		return "waiting";
	}
	return "done";
}

function formatActivityTokenCount(tokens: number): string {
	if (tokens >= 1_000) {
		return `${Math.round(tokens / 100) / 10}k`;
	}
	return String(tokens);
}

export function getActivityToneClassName(tone: TaskActivityStep["tone"]): string {
	if (tone === "active") {
		return "border-status-blue text-status-blue";
	}
	if (tone === "done") {
		return "border-status-green text-status-green";
	}
	if (tone === "waiting") {
		return "border-status-gold text-status-gold";
	}
	if (tone === "issue") {
		return "border-status-red text-status-red";
	}
	return "border-border-bright text-text-tertiary";
}

function formatRoutingActivityDetail(selection: CardSelection, summary: RuntimeTaskSessionSummary | null): string {
	const providerId = summary?.providerId?.trim() || selection.card.nkleinSettings?.providerId?.trim();
	const modelId = summary?.modelId?.trim() || selection.card.nkleinSettings?.modelId?.trim();
	const endpoint = summary?.sharedEndpointId?.trim();
	if (providerId && modelId) {
		const source =
			selection.card.nkleinSettings?.providerId || selection.card.nkleinSettings?.modelId
				? "card-selected"
				: "runtime-selected";
		return endpoint
			? `${source}: ${providerId} / ${modelId} on ${endpoint}`
			: `${source}: ${providerId} / ${modelId}`;
	}
	return summary?.agentId ?? selection.card.agentId ?? "Default agent selection";
}

function isRetrievalOrIndexingTool(toolName: string | null | undefined): boolean {
	const normalized = toolName?.trim().toLowerCase();
	return (
		normalized === "read_files" ||
		normalized === "read_file" ||
		normalized === "read_large_file" ||
		normalized === "search_files" ||
		normalized === "search_code" ||
		normalized === "list_files" ||
		normalized === "get_file_size" ||
		normalized === "get_repo_map"
	);
}

function isAcceptanceActivityEvent(event: RuntimeTaskDiagnosticEvent): boolean {
	return event.signal === "verification_failed" || event.signal === "plan_gap";
}

function isMergeActivityEvent(event: RuntimeTaskDiagnosticEvent): boolean {
	return event.signal === "custom" && event.metadata?.category === "task_worktree_merge";
}

function formatActivityEventDetail(event: RuntimeTaskDiagnosticEvent | null, fallback: string): string {
	if (!event) {
		return fallback;
	}
	return `${formatDiagnosticTime(event.createdAt)} ${event.message}`;
}

export function buildTaskActivitySteps(
	selection: CardSelection,
	summary: RuntimeTaskSessionSummary | null,
	diagnosticEvents: readonly RuntimeTaskDiagnosticEvent[] = [],
): TaskActivityStep[] {
	const modelParts = [summary?.providerId, summary?.modelId].filter(
		(part): part is string => typeof part === "string" && part.trim().length > 0,
	);
	const contextBreakdown = summary?.contextBudgetBreakdown ?? null;
	const contextPercent = contextBreakdown
		? Math.round((contextBreakdown.projectedTokens / contextBreakdown.effectiveContextWindow) * 100)
		: null;
	const hookActivity = summary?.latestHookActivity;
	const isRetrievalActive = isRetrievalOrIndexingTool(hookActivity?.toolName);
	const latestAcceptanceEvent = diagnosticEvents.find(isAcceptanceActivityEvent) ?? null;
	const latestMergeEvent = diagnosticEvents.find(isMergeActivityEvent) ?? null;
	const acceptanceDetail =
		selection.column.id === "completed"
			? "Completed"
			: selection.column.id === "review"
				? "Ready for review"
				: selection.card.autoReviewEnabled
					? `Auto-review ${selection.card.autoReviewMode ?? "commit"}`
					: "Manual review";
	return [
		{
			label: "Planning",
			status: selection.column.id === "planning" ? "In planning" : "Ready",
			detail: selection.card.startInPlanMode ? "Plan mode requested" : "Execution card",
			tone: selection.column.id === "planning" ? "active" : "done",
		},
		{
			label: "Routing",
			status: summary?.state === "running" ? "Selected" : modelParts.length > 0 ? "Known" : "Pending",
			detail: formatRoutingActivityDetail(selection, summary),
			tone: summary?.state === "running" ? "active" : modelParts.length > 0 ? "done" : "waiting",
		},
		{
			label: "Context",
			status: contextPercent === null ? "Waiting" : `${Math.min(100, Math.max(0, contextPercent))}%`,
			detail: contextBreakdown
				? `${formatActivityTokenCount(contextBreakdown.projectedTokens)} / ${formatActivityTokenCount(
						contextBreakdown.effectiveContextWindow,
					)} tokens`
				: "No budget snapshot yet",
			tone:
				contextPercent === null
					? "waiting"
					: contextPercent >= 100
						? "issue"
						: contextPercent >= 85
							? "waiting"
							: "done",
		},
		{
			label: "Retrieval",
			status: isRetrievalActive
				? (hookActivity?.toolName ?? "Active")
				: summary?.state === "running"
					? "Watching"
					: "Idle",
			detail: isRetrievalActive
				? (hookActivity?.toolInputSummary ?? hookActivity?.activityText ?? "Retrieving workspace context")
				: "No retrieval or indexing activity",
			tone: isRetrievalActive ? "active" : summary?.state === "running" ? "waiting" : "muted",
		},
		{
			label: "Tool calls",
			status: hookActivity?.toolName ? hookActivity.toolName : summary?.state === "running" ? "Active" : "Idle",
			detail: hookActivity?.activityText ?? "No live tool activity",
			tone: summary?.state === "running" ? "active" : "muted",
		},
		{
			label: "Acceptance",
			status: latestAcceptanceEvent
				? latestAcceptanceEvent.signal === "verification_failed"
					? "Failed"
					: "Plan gap"
				: selection.column.title,
			detail: formatActivityEventDetail(latestAcceptanceEvent, acceptanceDetail),
			tone: latestAcceptanceEvent
				? getDiagnosticEventTone(latestAcceptanceEvent)
				: selection.column.id === "completed"
					? "done"
					: selection.column.id === "review"
						? "waiting"
						: "muted",
		},
		{
			label: "Merge",
			status: latestMergeEvent
				? latestMergeEvent.severity === "warning" || latestMergeEvent.severity === "error"
					? "Needs review"
					: "Recorded"
				: selection.column.id === "completed"
					? "Merged or done"
					: selection.column.id === "review"
						? "Pending"
						: "Not ready",
			detail: formatActivityEventDetail(
				latestMergeEvent,
				selection.column.id === "review"
					? "Merge runs after review completion"
					: selection.column.id === "completed"
						? "No merge diagnostic event yet"
						: "Waiting for review",
			),
			tone: latestMergeEvent
				? getDiagnosticEventTone(latestMergeEvent)
				: selection.column.id === "review"
					? "waiting"
					: selection.column.id === "completed"
						? "done"
						: "muted",
		},
	];
}

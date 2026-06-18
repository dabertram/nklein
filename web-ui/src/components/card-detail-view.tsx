import type { DropResult } from "@hello-pangea/dnd";
import {
	Activity,
	Files,
	GitBranch,
	GitCompareArrows,
	Maximize2,
	MessageSquare,
	Minimize2,
	RefreshCw,
	X,
} from "lucide-react";
import type { MouseEvent as ReactMouseEvent, ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useHotkeys } from "react-hotkeys-hook";
import { AgentTerminalPanel } from "@/components/detail-panels/agent-terminal-panel";
import { ClineAgentChatPanel, type ClineAgentChatPanelHandle } from "@/components/detail-panels/cline-agent-chat-panel";
import { ColumnContextPanel } from "@/components/detail-panels/column-context-panel";
import { type DiffLineComment, DiffViewerPanel } from "@/components/detail-panels/diff-viewer-panel";
import { FileTreePanel } from "@/components/detail-panels/file-tree-panel";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { Spinner } from "@/components/ui/spinner";
import type { ClineChatActionResult } from "@/hooks/use-cline-chat-runtime-actions";
import type { ClineChatMessage } from "@/hooks/use-cline-chat-session";
import { useIsMobile } from "@/hooks/use-is-mobile";
import { ResizableBottomPane } from "@/resize/resizable-bottom-pane";
import { ResizeHandle } from "@/resize/resize-handle";
import { useCardDetailLayout } from "@/resize/use-card-detail-layout";
import { useResizeDrag } from "@/resize/use-resize-drag";
import { isNativeClineAgentSelected } from "@/runtime/native-agent";
import { fetchTaskDiagnostics } from "@/runtime/runtime-config-query";
import type {
	RuntimeAgentId,
	RuntimeClineReasoningEffort,
	RuntimeClineTeamProgressEvent,
	RuntimeConfigResponse,
	RuntimeTaskDiagnosticEvent,
	RuntimeTaskSessionMode,
	RuntimeTaskSessionSummary,
	RuntimeWorkspaceChangesMode,
} from "@/runtime/types";
import { useRuntimeWorkspaceChanges } from "@/runtime/use-runtime-workspace-changes";
import { useTaskWorkspaceStateVersionValue } from "@/stores/workspace-metadata-store";
import { useTerminalThemeColors } from "@/terminal/theme-colors";
import { type BoardCard, type BoardDependency, type CardSelection, getTaskAutoReviewCancelButtonLabel } from "@/types";
import { useWindowEvent } from "@/utils/react-use";

// We still poll the open detail diff because line content can change without changing
// the overall file or line counts that drive the shared workspace metadata stream.
const DETAIL_DIFF_POLL_INTERVAL_MS = 1_000;
const DIFF_MODE_ACTIVE_BACKGROUND = "color-mix(in srgb, var(--color-surface-3) 80%, var(--color-text-primary))";

function isTypingTarget(target: EventTarget | null): boolean {
	if (!(target instanceof HTMLElement)) {
		return false;
	}
	return target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable;
}

function isEventInsideDialog(target: EventTarget | null): boolean {
	return target instanceof Element && target.closest("[role='dialog']") !== null;
}

/** Shared factory for the three horizontal resize-drag handlers in the detail view. */
function useResizeHandler(
	containerRef: React.RefObject<HTMLDivElement | null>,
	ratio: number,
	setRatio: (r: number) => void,
	startDrag: ReturnType<typeof useResizeDrag>["startDrag"],
	invert = false,
): (event: ReactMouseEvent<HTMLDivElement>) => void {
	return useCallback(
		(event: ReactMouseEvent<HTMLDivElement>) => {
			const container = containerRef.current;
			if (!container) {
				return;
			}
			const containerWidth = Math.max(container.offsetWidth, 1);
			const startX = event.clientX;
			const sign = invert ? -1 : 1;
			const applyDelta = (pointerX: number) => {
				setRatio(ratio + sign * ((pointerX - startX) / containerWidth));
			};
			startDrag(event, { axis: "x", cursor: "ew-resize", onMove: applyDelta, onEnd: applyDelta });
		},
		[containerRef, ratio, setRatio, startDrag, invert],
	);
}

function SkeletonLine({ width, mb }: { width: string; mb?: boolean }): React.ReactElement {
	return <div className={cn("kb-skeleton h-[13px] rounded-sm", mb && "mb-[7px]")} style={{ width }} />;
}

function SkeletonFileRow({ width }: { width: string }): React.ReactElement {
	return (
		<div className="mb-0.5 flex items-center gap-2 px-2 py-1.5">
			<div className="kb-skeleton h-3 w-3 rounded-sm" />
			<div className="kb-skeleton h-[13px] rounded-sm" style={{ width }} />
		</div>
	);
}

function WorkspaceChangesLoadingPanel({ panelFlex }: { panelFlex: string }): React.ReactElement {
	return (
		<div className="flex min-h-0 min-w-0 bg-surface-0" style={{ flex: "1.6 1 0" }}>
			<div className="flex flex-1 flex-col border-r border-divider">
				<div className="px-2.5 pt-2.5 pb-1.5">
					<div className="mb-2.5 flex items-center gap-2">
						<div className="kb-skeleton h-3.5 rounded-sm" style={{ width: "62%" }} />
						<div className="kb-skeleton h-4 w-[42px] rounded-full" />
					</div>
					<SkeletonLine width="92%" mb />
					<SkeletonLine width="84%" mb />
					<SkeletonLine width="95%" mb />
					<SkeletonLine width="79%" mb />
					<SkeletonLine width="88%" mb />
					<SkeletonLine width="76%" />
				</div>
				<div className="flex-1" />
			</div>
			<div className="flex flex-col px-2 py-2.5" style={{ flex: panelFlex }}>
				<SkeletonFileRow width="61%" />
				<SkeletonFileRow width="70%" />
				<SkeletonFileRow width="53%" />
				<div className="flex-1" />
			</div>
		</div>
	);
}

function BottomTerminalSection({
	taskId,
	workspaceId,
	summary,
	onSummary,
	onClose,
	subtitle,
	terminalThemeColors,
	onConnectionReady,
	agentCommand,
	onSendAgentCommand,
	paneHeight,
	onPaneHeightChange,
	onCollapse,
	isExpanded,
	onToggleExpand,
}: {
	taskId: string;
	workspaceId: string | null;
	summary: RuntimeTaskSessionSummary | null;
	onSummary: (summary: RuntimeTaskSessionSummary) => void;
	onClose: () => void;
	subtitle?: string | null;
	terminalThemeColors: { surfaceRaised: string; textPrimary: string };
	onConnectionReady?: (taskId: string) => void;
	agentCommand?: string | null;
	onSendAgentCommand?: () => void;
	paneHeight?: number;
	onPaneHeightChange?: (height: number) => void;
	onCollapse?: () => void;
	isExpanded?: boolean;
	onToggleExpand?: () => void;
}): React.ReactElement {
	return (
		<ResizableBottomPane
			minHeight={200}
			initialHeight={paneHeight}
			onHeightChange={onPaneHeightChange}
			onCollapse={onCollapse}
			isExpanded={isExpanded}
		>
			<div className="flex min-w-0 flex-1 px-3">
				<AgentTerminalPanel
					taskId={taskId}
					workspaceId={workspaceId}
					summary={summary}
					onSummary={onSummary}
					showSessionToolbar={false}
					autoFocus
					onClose={onClose}
					minimalHeaderTitle="Terminal"
					minimalHeaderSubtitle={subtitle}
					panelBackgroundColor="var(--color-surface-1)"
					terminalBackgroundColor={terminalThemeColors.surfaceRaised}
					cursorColor={terminalThemeColors.textPrimary}
					onConnectionReady={onConnectionReady}
					agentCommand={agentCommand}
					onSendAgentCommand={onSendAgentCommand}
					isExpanded={isExpanded}
					onToggleExpand={onToggleExpand}
				/>
			</div>
		</ResizableBottomPane>
	);
}

function WorkspaceChangesEmptyPanel({ title }: { title: string }): React.ReactElement {
	return (
		<div className="flex min-h-0 min-w-0 bg-surface-0" style={{ flex: "1.6 1 0" }}>
			<div className="kb-empty-state-center flex-1">
				<div className="flex flex-col items-center justify-center gap-3 py-12 text-text-tertiary">
					<GitCompareArrows size={40} />
					<h3 className="font-semibold text-text-secondary">{title}</h3>
				</div>
			</div>
		</div>
	);
}

function formatDiagnosticTime(createdAt: number): string {
	if (!Number.isFinite(createdAt)) {
		return "unknown";
	}
	return new Date(createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function getDiagnosticSeverityClassName(severity: RuntimeTaskDiagnosticEvent["severity"]): string {
	if (severity === "error") {
		return "text-status-red";
	}
	if (severity === "warning") {
		return "text-status-orange";
	}
	return "text-text-secondary";
}

interface TaskActivityStep {
	label: string;
	status: string;
	detail: string;
	tone: "active" | "done" | "waiting" | "issue" | "muted";
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

function getActivityToneClassName(tone: TaskActivityStep["tone"]): string {
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
	const providerId = summary?.providerId?.trim() || selection.card.clineSettings?.providerId?.trim();
	const modelId = summary?.modelId?.trim() || selection.card.clineSettings?.modelId?.trim();
	const endpoint = summary?.sharedEndpointId?.trim();
	if (providerId && modelId) {
		const source =
			selection.card.clineSettings?.providerId || selection.card.clineSettings?.modelId
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

function buildTaskActivitySteps(
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

function TaskActivitySurface({
	selection,
	sessionSummary,
	workspaceId,
}: {
	selection: CardSelection;
	sessionSummary: RuntimeTaskSessionSummary | null;
	workspaceId: string | null;
}): React.ReactElement {
	const [diagnosticEvents, setDiagnosticEvents] = useState<RuntimeTaskDiagnosticEvent[]>([]);
	useEffect(() => {
		let cancelled = false;
		setDiagnosticEvents([]);
		if (!workspaceId) {
			return;
		}
		void fetchTaskDiagnostics(workspaceId, selection.card.id, 20)
			.then((response) => {
				if (!cancelled && response.ok) {
					setDiagnosticEvents(response.events);
				}
			})
			.catch(() => {
				if (!cancelled) {
					setDiagnosticEvents([]);
				}
			});
		return () => {
			cancelled = true;
		};
	}, [selection.card.id, workspaceId]);
	const steps = useMemo(
		() => buildTaskActivitySteps(selection, sessionSummary, diagnosticEvents),
		[diagnosticEvents, selection, sessionSummary],
	);
	return (
		<div className="border-b border-border bg-surface-1 px-3 py-2">
			<div className="mb-2 flex min-w-0 items-center gap-2 text-[12px] font-medium text-text-primary">
				<Activity size={14} className="shrink-0 text-text-secondary" />
				<span>Activity</span>
				<span className="truncate text-text-tertiary">{sessionSummary?.state ?? "No session"}</span>
			</div>
			<div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 xl:grid-cols-7">
				{steps.map((step) => (
					<div key={step.label} className="min-w-0 rounded-md border border-border bg-surface-0 px-2 py-1.5">
						<div className="flex min-w-0 items-center gap-1.5">
							<span
								className={cn("h-2 w-2 shrink-0 rounded-full border", getActivityToneClassName(step.tone))}
								aria-hidden="true"
							/>
							<span className="truncate text-[11px] font-medium text-text-primary">{step.label}</span>
							<span className="truncate text-[11px] text-text-tertiary">{step.status}</span>
						</div>
						<div className="mt-1 truncate text-[11px] text-text-secondary">{step.detail}</div>
					</div>
				))}
			</div>
		</div>
	);
}

interface PlanningDagNode {
	card: BoardCard;
	columnTitle: string;
	relation: "selected" | "blocked-by" | "unblocks" | "related";
}

function parseComplexityFromPrompt(prompt: string): number | null {
	const match = prompt.match(/^Complexity:\s*(\d{1,3})\/100\s*$/im);
	if (!match) {
		return null;
	}
	const value = Number(match[1]);
	return Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : null;
}

function parseModelFitFromPrompt(prompt: string): { label: string; detail: string; tone: "done" | "waiting" } {
	const match = prompt.match(/^Model fit:\s*(.+)$/im);
	const detail = match?.[1]?.trim() ?? null;
	if (!detail) {
		return {
			label: "Backend fit pending",
			detail: "No backend fit marker on this card",
			tone: "waiting",
		};
	}
	if (detail.toLowerCase().startsWith("validated by kanban routing guard")) {
		return {
			label: "Backend fit validated",
			detail,
			tone: "done",
		};
	}
	return {
		label: "Backend fit starts later",
		detail,
		tone: "waiting",
	};
}

function formatDagModelLabel(card: BoardCard): string {
	const providerId = card.clineSettings?.providerId?.trim();
	const modelId = card.clineSettings?.modelId?.trim();
	if (providerId && modelId) {
		return `${providerId} / ${modelId}`;
	}
	if (card.agentId === "cline" || card.clineSettings) {
		return "Cline local model";
	}
	return card.agentId ?? "Default agent";
}

function getDagNodeToneClassName(relation: PlanningDagNode["relation"]): string {
	if (relation === "selected") {
		return "border-accent bg-accent/5";
	}
	if (relation === "blocked-by") {
		return "border-status-gold/40 bg-status-gold/5";
	}
	if (relation === "related") {
		return "border-border-bright bg-surface-0";
	}
	return "border-status-green/30 bg-status-green/5";
}

function buildPlanningDagNodes(selection: CardSelection, dependencies: readonly BoardDependency[]): PlanningDagNode[] {
	const cardsById = new Map(
		selection.allColumns.flatMap((column) =>
			column.cards.map((card) => [card.id, { card, columnTitle: column.title }]),
		),
	);
	const directPrerequisiteIds = new Set<string>();
	const directDependentIds = new Set<string>();
	const linkedByTaskId = new Map<string, Set<string>>();
	for (const dependency of dependencies) {
		if (dependency.fromTaskId === selection.card.id) {
			directPrerequisiteIds.add(dependency.toTaskId);
		}
		if (dependency.toTaskId === selection.card.id) {
			directDependentIds.add(dependency.fromTaskId);
		}
		for (const [left, right] of [
			[dependency.fromTaskId, dependency.toTaskId],
			[dependency.toTaskId, dependency.fromTaskId],
		] as const) {
			const linked = linkedByTaskId.get(left) ?? new Set<string>();
			linked.add(right);
			linkedByTaskId.set(left, linked);
		}
	}
	const orderedTaskIds: string[] = [];
	const visitedTaskIds = new Set<string>();
	const queue = [selection.card.id];
	for (let index = 0; index < queue.length; index += 1) {
		const taskId = queue[index];
		if (!taskId || visitedTaskIds.has(taskId)) {
			continue;
		}
		visitedTaskIds.add(taskId);
		if (cardsById.has(taskId)) {
			orderedTaskIds.push(taskId);
		}
		for (const linkedTaskId of linkedByTaskId.get(taskId) ?? []) {
			if (!visitedTaskIds.has(linkedTaskId)) {
				queue.push(linkedTaskId);
			}
		}
	}
	return orderedTaskIds.map((taskId) => {
		const cardEntry = cardsById.get(taskId);
		if (!cardEntry) {
			return { card: selection.card, columnTitle: selection.column.title, relation: "selected" };
		}
		return {
			...cardEntry,
			relation:
				taskId === selection.card.id
					? "selected"
					: directPrerequisiteIds.has(taskId)
						? "blocked-by"
						: directDependentIds.has(taskId)
							? "unblocks"
							: "related",
		};
	});
}

function PlanningDagReviewPanel({
	selection,
	dependencies,
}: {
	selection: CardSelection;
	dependencies: readonly BoardDependency[];
}): React.ReactElement | null {
	const nodes = useMemo(() => buildPlanningDagNodes(selection, dependencies), [dependencies, selection]);
	if (selection.column.id !== "planning" && nodes.length <= 1) {
		return null;
	}
	const edgeCount = nodes.length - 1;
	return (
		<div className="border-b border-border bg-surface-1 px-3 py-2">
			<div className="mb-2 flex min-w-0 items-center gap-2 text-[12px] font-medium text-text-primary">
				<GitBranch size={14} className="shrink-0 text-text-secondary" />
				<span>Plan DAG</span>
				<span className="truncate text-text-tertiary">
					{edgeCount > 0 ? `${edgeCount} linked ${edgeCount === 1 ? "card" : "cards"}` : "No linked cards"}
				</span>
			</div>
			<div className="grid grid-cols-1 gap-1.5 xl:grid-cols-3">
				{nodes.map((node) => {
					const complexity = parseComplexityFromPrompt(node.card.prompt);
					const modelFit = parseModelFitFromPrompt(node.card.prompt);
					const likelyFiles = node.card.filesLikelyTouched ?? [];
					return (
						<div
							key={`${node.relation}:${node.card.id}`}
							className={cn("min-w-0 rounded-md border px-2 py-1.5", getDagNodeToneClassName(node.relation))}
						>
							<div className="flex min-w-0 items-center gap-1.5">
								<span className="truncate text-[11px] font-medium text-text-primary">{node.card.title}</span>
								<span className="shrink-0 text-[11px] text-text-tertiary">{node.columnTitle}</span>
							</div>
							<div className="mt-1 truncate text-[11px] text-text-secondary">
								{node.relation === "selected"
									? "Selected card"
									: node.relation === "blocked-by"
										? "Blocked by prerequisite"
										: node.relation === "unblocks"
											? "Unblocks dependent"
											: "Linked plan card"}
							</div>
							<div className="mt-1 flex min-w-0 flex-wrap gap-x-2 gap-y-1 text-[11px] text-text-tertiary">
								<span>{complexity === null ? "Complexity unknown" : `Complexity ${complexity}/100`}</span>
								<span
									className={
										complexity !== null && complexity <= 75 ? "text-status-green" : "text-status-orange"
									}
								>
									{complexity !== null && complexity <= 75 ? "Fit likely" : "Fit needs review"}
								</span>
								<span
									className={modelFit.tone === "done" ? "text-status-green" : "text-status-orange"}
									title={modelFit.detail}
								>
									{modelFit.label}
								</span>
								<span className="truncate">{formatDagModelLabel(node.card)}</span>
							</div>
							{likelyFiles.length > 0 ? (
								<div className="mt-1 truncate text-[11px] text-text-tertiary">
									{likelyFiles.slice(0, 3).join(", ")}
									{likelyFiles.length > 3 ? ` +${likelyFiles.length - 3}` : ""}
								</div>
							) : null}
						</div>
					);
				})}
			</div>
		</div>
	);
}

function TaskDiagnosticsPanel({
	workspaceId,
	taskId,
}: {
	workspaceId: string | null;
	taskId: string;
}): React.ReactElement {
	const [open, setOpen] = useState(false);
	const [isLoading, setIsLoading] = useState(false);
	const [events, setEvents] = useState<RuntimeTaskDiagnosticEvent[]>([]);
	const [error, setError] = useState<string | null>(null);

	const refreshDiagnostics = useCallback(() => {
		if (!workspaceId) {
			setEvents([]);
			return;
		}
		setIsLoading(true);
		setError(null);
		void fetchTaskDiagnostics(workspaceId, taskId, 20)
			.then((response) => {
				if (!response.ok) {
					throw new Error(response.error ?? "Could not load diagnostics.");
				}
				setEvents(response.events);
			})
			.catch((refreshError) => {
				const message = refreshError instanceof Error ? refreshError.message : String(refreshError);
				setError(message);
			})
			.finally(() => {
				setIsLoading(false);
			});
	}, [taskId, workspaceId]);

	useEffect(() => {
		setEvents([]);
		setError(null);
		if (open) {
			refreshDiagnostics();
		}
	}, [open, refreshDiagnostics]);

	return (
		<div className="border-b border-border bg-surface-1 px-3 py-2">
			<div className="flex items-center justify-between gap-2">
				<button
					type="button"
					className="flex min-w-0 cursor-pointer items-center gap-2 text-left text-[12px] font-medium text-text-primary"
					onClick={() => {
						setOpen((current) => !current);
					}}
				>
					<Activity size={14} className="shrink-0 text-text-secondary" />
					<span>Diagnostics</span>
					<span className="truncate text-text-tertiary">
						{error ? "Issue" : open ? `${events.length} events` : "Local telemetry"}
					</span>
				</button>
				<Button
					size="sm"
					variant="ghost"
					icon={isLoading ? <Spinner size={14} /> : <RefreshCw size={14} />}
					disabled={!open || isLoading || !workspaceId}
					onClick={refreshDiagnostics}
				>
					Refresh
				</Button>
			</div>
			{open ? (
				<div className="mt-2 max-h-36 overflow-auto rounded-md border border-border bg-surface-0 p-2 text-[11px]">
					{error ? <div className="text-status-red">{error}</div> : null}
					{!error && isLoading ? <div className="text-text-secondary">Loading diagnostics...</div> : null}
					{!error && !isLoading && events.length === 0 ? (
						<div className="text-text-secondary">No diagnostics recorded for this card.</div>
					) : null}
					{events.map((event) => (
						<div
							key={`${event.createdAt}-${event.signal}-${event.message}`}
							className="border-b border-border/60 py-1 last:border-b-0"
						>
							<div className="flex min-w-0 items-center gap-2">
								<span className={cn("font-mono uppercase", getDiagnosticSeverityClassName(event.severity))}>
									{event.severity}
								</span>
								<span className="font-mono text-text-tertiary">{formatDiagnosticTime(event.createdAt)}</span>
								<span className="truncate font-mono text-text-secondary">{event.signal}</span>
							</div>
							<div className="mt-0.5 break-words text-text-primary">{event.message}</div>
						</div>
					))}
				</div>
			) : null}
		</div>
	);
}

type MobileTab = "chat" | "diff" | "files";

const MOBILE_TABS: { id: MobileTab; label: string; icon: React.ReactElement }[] = [
	{ id: "chat", label: "Chat", icon: <MessageSquare size={14} /> },
	{ id: "diff", label: "Diff", icon: <GitCompareArrows size={14} /> },
	{ id: "files", label: "Files", icon: <Files size={14} /> },
];

function MobileDetailTabBar({
	activeTab,
	onTabChange,
}: {
	activeTab: MobileTab;
	onTabChange: (tab: MobileTab) => void;
}): React.ReactElement {
	const tabs = MOBILE_TABS;
	return (
		<div className="flex items-center border-b border-border" style={{ minHeight: 36 }}>
			{tabs.map((tab) => (
				<button
					key={tab.id}
					type="button"
					className={cn(
						"relative flex flex-1 items-center justify-center gap-1.5 px-2 py-2 text-xs font-medium transition-colors",
						activeTab === tab.id ? "text-accent" : "text-text-secondary",
					)}
					onClick={() => onTabChange(tab.id)}
				>
					{tab.icon}
					{tab.label}
					{activeTab === tab.id ? <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-accent" /> : null}
				</button>
			))}
		</div>
	);
}

function DiffModeButton({
	active,
	onClick,
	children,
}: {
	active: boolean;
	onClick: () => void;
	children: React.ReactNode;
}): React.ReactElement {
	return (
		<Button
			variant="ghost"
			size="sm"
			onClick={onClick}
			aria-pressed={active}
			className="h-5 rounded-sm text-xs"
			style={
				active
					? {
							backgroundColor: DIFF_MODE_ACTIVE_BACKGROUND,
							color: "var(--color-text-primary)",
						}
					: undefined
			}
		>
			{children}
		</Button>
	);
}

function DiffToolbar({
	mode,
	onModeChange,
	isExpanded,
	onToggleExpand,
	hideExpand,
}: {
	mode: RuntimeWorkspaceChangesMode;
	onModeChange: (mode: RuntimeWorkspaceChangesMode) => void;
	isExpanded: boolean;
	onToggleExpand: () => void;
	hideExpand?: boolean;
}): React.ReactElement {
	return (
		<div className="flex items-center gap-1 border-b border-divider px-2 py-1">
			{isExpanded ? (
				<Button
					variant="ghost"
					size="sm"
					icon={<X size={14} />}
					onClick={onToggleExpand}
					className="h-5"
					aria-label="Collapse expanded diff view"
				/>
			) : null}
			<div className="inline-flex items-center gap-0.5 rounded-md p-0.5">
				<DiffModeButton active={mode === "working_copy"} onClick={() => onModeChange("working_copy")}>
					All Changes
				</DiffModeButton>
				<DiffModeButton active={mode === "last_turn"} onClick={() => onModeChange("last_turn")}>
					Last Turn
				</DiffModeButton>
			</div>
			{!hideExpand ? (
				<Button
					variant="ghost"
					size="sm"
					icon={isExpanded ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
					onClick={onToggleExpand}
					className="ml-auto h-5"
					aria-label={isExpanded ? "Collapse split diff view" : "Expand split diff view"}
				/>
			) : null}
		</div>
	);
}

export function CardDetailView({
	selection,
	dependencies = [],
	currentProjectId,
	workspacePath,
	selectedAgentId = null,
	runtimeConfig = null,
	sessionSummary,
	taskSessions,
	onSessionSummary,
	onCardSelect,
	onTaskDragEnd,
	onCreateTask,
	onStartTask,
	onStartAllTasks,
	onClearTrash,
	editingTaskId,
	inlineTaskEditor,
	onEditTask,
	onSaveTaskTitle,
	onCommitTask,
	onOpenPrTask,
	onAgentCommitTask,
	onAgentOpenPrTask,
	onMoveReviewCardToTrash,
	onRestoreTaskFromTrash,
	onCancelAutomaticTaskAction,
	commitTaskLoadingById,
	openPrTaskLoadingById,
	agentCommitTaskLoadingById,
	agentOpenPrTaskLoadingById,
	moveToTrashLoadingById,
	onAddReviewComments,
	onSendReviewComments,
	onSendClineChatMessage,
	onCancelClineChatTurn,
	onLoadClineChatMessages,
	latestClineChatMessage,
	streamedClineChatMessages,
	clineTeamProgress,
	onMoveToTrash,
	isMoveToTrashLoading,
	gitHistoryPanel,
	onCloseGitHistory,
	bottomTerminalOpen,
	bottomTerminalTaskId,
	bottomTerminalSummary,
	bottomTerminalSubtitle,
	onBottomTerminalClose,
	onBottomTerminalCollapse,
	bottomTerminalPaneHeight,
	onBottomTerminalPaneHeightChange,
	onBottomTerminalConnectionReady,
	bottomTerminalAgentCommand,
	onBottomTerminalSendAgentCommand,
	isBottomTerminalExpanded,
	onBottomTerminalToggleExpand,
	isDocumentVisible = true,
	onClineSettingsSaved,
	onTaskClineSettingsChanged,
}: {
	selection: CardSelection;
	dependencies?: BoardDependency[];
	currentProjectId: string | null;
	workspacePath?: string | null;
	selectedAgentId?: RuntimeAgentId | null;
	runtimeConfig?: RuntimeConfigResponse | null;
	sessionSummary: RuntimeTaskSessionSummary | null;
	taskSessions: Record<string, RuntimeTaskSessionSummary>;
	onSessionSummary: (summary: RuntimeTaskSessionSummary) => void;
	onCardSelect: (taskId: string) => void;
	onTaskDragEnd: (result: DropResult) => void;
	onCreateTask?: () => void;
	onStartTask?: (taskId: string) => void;
	onStartAllTasks?: () => void;
	onClearTrash?: () => void;
	editingTaskId?: string | null;
	inlineTaskEditor?: ReactNode;
	onEditTask?: (card: BoardCard) => void;
	onSaveTaskTitle?: (taskId: string, title: string) => void;
	onCommitTask?: (taskId: string) => void;
	onOpenPrTask?: (taskId: string) => void;
	onAgentCommitTask?: (taskId: string) => void;
	onAgentOpenPrTask?: (taskId: string) => void;
	onMoveReviewCardToTrash?: (taskId: string) => void;
	onRestoreTaskFromTrash?: (taskId: string) => void;
	onCancelAutomaticTaskAction?: (taskId: string) => void;
	commitTaskLoadingById?: Record<string, boolean>;
	openPrTaskLoadingById?: Record<string, boolean>;
	agentCommitTaskLoadingById?: Record<string, boolean>;
	agentOpenPrTaskLoadingById?: Record<string, boolean>;
	moveToTrashLoadingById?: Record<string, boolean>;
	onAddReviewComments?: (taskId: string, text: string) => void;
	onSendReviewComments?: (taskId: string, text: string) => void;
	onSendClineChatMessage?: (
		taskId: string,
		text: string,
		options?: { mode?: RuntimeTaskSessionMode },
	) => Promise<ClineChatActionResult>;
	onCancelClineChatTurn?: (taskId: string) => Promise<{ ok: boolean; message?: string }>;
	onLoadClineChatMessages?: (taskId: string) => Promise<ClineChatMessage[] | null>;
	latestClineChatMessage?: ClineChatMessage | null;
	streamedClineChatMessages?: ClineChatMessage[] | null;
	clineTeamProgress?: RuntimeClineTeamProgressEvent[];
	onMoveToTrash: () => void;
	isMoveToTrashLoading?: boolean;
	gitHistoryPanel?: ReactNode;
	onCloseGitHistory?: () => void;
	bottomTerminalOpen: boolean;
	bottomTerminalTaskId: string | null;
	bottomTerminalSummary: RuntimeTaskSessionSummary | null;
	bottomTerminalSubtitle?: string | null;
	onBottomTerminalClose: () => void;
	onBottomTerminalCollapse?: () => void;
	bottomTerminalPaneHeight?: number;
	onBottomTerminalPaneHeightChange?: (height: number) => void;
	onBottomTerminalConnectionReady?: (taskId: string) => void;
	bottomTerminalAgentCommand?: string | null;
	onBottomTerminalSendAgentCommand?: () => void;
	isBottomTerminalExpanded?: boolean;
	onBottomTerminalToggleExpand?: () => void;
	isDocumentVisible?: boolean;
	onClineSettingsSaved?: () => void;
	onTaskClineSettingsChanged?: (settings: {
		providerId: string;
		modelId: string;
		reasoningEffort: RuntimeClineReasoningEffort | "";
		contextScope: "full" | "smart" | "minimal" | "custom";
		timeoutMode: "normal" | "long" | "extended" | "unlimited";
	}) => void;
}): React.ReactElement {
	const isMobile = useIsMobile();
	const [mobileTab, setMobileTab] = useState<MobileTab>("chat");
	const terminalThemeColors = useTerminalThemeColors();
	const [selectedPath, setSelectedPath] = useState<string | null>(null);
	const [diffComments, setDiffComments] = useState<Map<string, DiffLineComment>>(new Map());
	const [diffMode, setDiffMode] = useState<RuntimeWorkspaceChangesMode>("working_copy");
	const [isDiffExpanded, setIsDiffExpanded] = useState(false);
	const {
		taskCardsPanelRatio,
		setTaskCardsPanelRatio,
		agentPanelRatio,
		setAgentPanelRatio,
		detailDiffFileTreeRatio,
		setDetailDiffFileTreeRatio,
	} = useCardDetailLayout({
		isDiffExpanded,
	});
	const { startDrag: startTaskCardsPanelResize } = useResizeDrag();
	const { startDrag: startAgentPanelResize } = useResizeDrag();
	const { startDrag: startDetailDiffResize } = useResizeDrag();
	const detailLayoutRef = useRef<HTMLDivElement | null>(null);
	const hasExplicitTaskClineSettings =
		selection.card.agentId === "cline" || selection.card.clineSettings !== undefined;
	const mainRowRef = useRef<HTMLDivElement | null>(null);
	const detailDiffRowRef = useRef<HTMLDivElement | null>(null);
	const clineAgentChatPanelRef = useRef<ClineAgentChatPanelHandle | null>(null);

	const handleSeparatorMouseDown = useResizeHandler(
		detailLayoutRef,
		taskCardsPanelRatio,
		setTaskCardsPanelRatio,
		startTaskCardsPanelResize,
	);
	const handleAgentDiffSeparatorMouseDown = useResizeHandler(
		mainRowRef,
		agentPanelRatio,
		setAgentPanelRatio,
		startAgentPanelResize,
	);
	const handleDetailDiffSeparatorMouseDown = useResizeHandler(
		detailDiffRowRef,
		detailDiffFileTreeRatio,
		setDetailDiffFileTreeRatio,
		startDetailDiffResize,
		true,
	);
	const taskWorkspaceStateVersion = useTaskWorkspaceStateVersionValue(selection.card.id);
	const lastTurnViewKey =
		diffMode === "last_turn"
			? [
					sessionSummary?.state ?? "none",
					sessionSummary?.latestTurnCheckpoint?.commit ?? "none",
					sessionSummary?.previousTurnCheckpoint?.commit ?? "none",
				].join(":")
			: null;
	const { changes: workspaceChanges, isRuntimeAvailable } = useRuntimeWorkspaceChanges(
		selection.card.id,
		currentProjectId,
		selection.card.baseRef,
		diffMode,
		taskWorkspaceStateVersion,
		isDocumentVisible && !gitHistoryPanel && selection.column.id !== "trash" ? DETAIL_DIFF_POLL_INTERVAL_MS : null,
		lastTurnViewKey,
		true,
	);
	const runtimeFiles = workspaceChanges?.files ?? null;
	const isWorkspaceChangesPending = isRuntimeAvailable && workspaceChanges === null;
	const hasNoWorkspaceFileChanges =
		isRuntimeAvailable && workspaceChanges !== null && runtimeFiles !== null && runtimeFiles.length === 0;
	const emptyDiffTitle = diffMode === "last_turn" ? "No changes since last turn" : "No working changes";
	const taskCardsPanelPercent = `${(taskCardsPanelRatio * 100).toFixed(1)}%`;
	const detailContentPanelPercent = `${((1 - taskCardsPanelRatio) * 100).toFixed(1)}%`;
	const agentPanelPercent = `${(agentPanelRatio * 100).toFixed(1)}%`;
	const diffPanelPercent = `${((1 - agentPanelRatio) * 100).toFixed(1)}%`;
	const detailDiffFileTreePanelPercent = `${(detailDiffFileTreeRatio * 100).toFixed(1)}%`;
	const detailDiffContentPanelPercent = `${((1 - detailDiffFileTreeRatio) * 100).toFixed(1)}%`;
	const detailDiffFileTreePanelFlex = `0 0 ${detailDiffFileTreePanelPercent}`;
	const showMoveToTrashActions =
		selection.column.id === "review" || selection.column.id === "in_progress" || selection.column.id === "planning";
	const finishTaskButtonLabel = selection.column.id === "review" ? "Move Card To Completed" : "Move Card To Trash";
	const finishTaskButtonVariant = selection.column.id === "review" ? "primary" : "danger";
	const isTaskTerminalEnabled =
		selection.column.id === "planning" || selection.column.id === "in_progress" || selection.column.id === "review";
	const effectiveTaskAgentId = sessionSummary?.agentId ?? selection.card.agentId ?? selectedAgentId;
	const showClineAgentChatPanel = isNativeClineAgentSelected(effectiveTaskAgentId);
	const availablePaths = useMemo(() => {
		if (!runtimeFiles || runtimeFiles.length === 0) {
			return [];
		}
		return runtimeFiles.map((file) => file.path);
	}, [runtimeFiles]);

	const handleSelectAdjacentCard = useCallback(
		(step: number) => {
			const cards = selection.column.cards;
			const currentIndex = cards.findIndex((card) => card.id === selection.card.id);
			if (currentIndex === -1) {
				return;
			}
			const nextIndex = (currentIndex + step + cards.length) % cards.length;
			const nextCard = cards[nextIndex];
			if (nextCard) {
				onCardSelect(nextCard.id);
			}
		},
		[onCardSelect, selection.card.id, selection.column.cards],
	);

	useHotkeys(
		"up,left",
		() => {
			handleSelectAdjacentCard(-1);
		},
		{
			ignoreEventWhen: (event) => isTypingTarget(event.target),
			preventDefault: true,
		},
		[handleSelectAdjacentCard],
	);

	useWindowEvent(
		"keydown",
		useCallback(
			(event: KeyboardEvent) => {
				if (event.key !== "Escape" || event.defaultPrevented || isEventInsideDialog(event.target)) {
					return;
				}
				if (gitHistoryPanel && onCloseGitHistory) {
					event.preventDefault();
					onCloseGitHistory();
					return;
				}
				if (isTypingTarget(event.target)) {
					return;
				}
				if (isDiffExpanded) {
					event.preventDefault();
					setIsDiffExpanded(false);
				}
			},
			[gitHistoryPanel, isDiffExpanded, onCloseGitHistory],
		),
	);

	useHotkeys(
		"down,right",
		() => {
			handleSelectAdjacentCard(1);
		},
		{
			ignoreEventWhen: (event) => isTypingTarget(event.target),
			preventDefault: true,
		},
		[handleSelectAdjacentCard],
	);

	useEffect(() => {
		if (selectedPath && availablePaths.includes(selectedPath)) {
			return;
		}
		setSelectedPath(availablePaths[0] ?? null);
	}, [availablePaths, selectedPath]);

	useEffect(() => {
		setDiffComments(new Map());
		setDiffMode("working_copy");
	}, [selection.card.id]);

	const handleToggleDiffExpand = useCallback(() => {
		if (!isDiffExpanded && bottomTerminalOpen) {
			onBottomTerminalClose();
		}
		setIsDiffExpanded((previous) => !previous);
	}, [bottomTerminalOpen, isDiffExpanded, onBottomTerminalClose]);

	const handleAddDiffComments = useCallback(
		(formatted: string) => {
			if (showClineAgentChatPanel) {
				clineAgentChatPanelRef.current?.appendToDraft(formatted);
				setIsDiffExpanded(false);
				return;
			}
			onAddReviewComments?.(selection.card.id, formatted);
		},
		[onAddReviewComments, selection.card.id, showClineAgentChatPanel],
	);

	const handleSendDiffComments = useCallback(
		(formatted: string) => {
			if (showClineAgentChatPanel) {
				void clineAgentChatPanelRef.current?.sendText(formatted);
				setIsDiffExpanded(false);
				return;
			}
			onSendReviewComments?.(selection.card.id, formatted);
			setIsDiffExpanded(false);
		},
		[onSendReviewComments, selection.card.id, showClineAgentChatPanel],
	);

	const showBottomTerminal = bottomTerminalOpen && !!bottomTerminalTaskId;

	const agentChatPanel = showClineAgentChatPanel ? (
		<ClineAgentChatPanel
			ref={clineAgentChatPanelRef}
			taskId={selection.card.id}
			summary={sessionSummary}
			taskColumnId={selection.column.id}
			defaultMode="act"
			showComposerModeToggle={false}
			workspaceId={currentProjectId}
			taskTitle={selection.card.title}
			taskPrompt={selection.card.prompt}
			runtimeConfig={runtimeConfig}
			taskClineSettings={selection.card.clineSettings}
			taskHasExplicitClineSettings={hasExplicitTaskClineSettings}
			onClineSettingsSaved={onClineSettingsSaved}
			onTaskClineSettingsChanged={onTaskClineSettingsChanged}
			onSendMessage={onSendClineChatMessage}
			onCancelTurn={onCancelClineChatTurn}
			onLoadMessages={onLoadClineChatMessages}
			incomingMessages={streamedClineChatMessages}
			incomingMessage={latestClineChatMessage}
			teamProgress={clineTeamProgress}
			onCommit={onAgentCommitTask ? () => onAgentCommitTask(selection.card.id) : undefined}
			onOpenPr={onAgentOpenPrTask ? () => onAgentOpenPrTask(selection.card.id) : undefined}
			isCommitLoading={agentCommitTaskLoadingById?.[selection.card.id] ?? false}
			isOpenPrLoading={agentOpenPrTaskLoadingById?.[selection.card.id] ?? false}
			showMoveToTrash={showMoveToTrashActions}
			onMoveToTrash={onMoveToTrash}
			isMoveToTrashLoading={isMoveToTrashLoading}
			moveToTrashButtonLabel={finishTaskButtonLabel}
			moveToTrashButtonVariant={finishTaskButtonVariant}
			onCancelAutomaticAction={
				selection.card.autoReviewEnabled === true && onCancelAutomaticTaskAction
					? () => onCancelAutomaticTaskAction(selection.card.id)
					: undefined
			}
			cancelAutomaticActionLabel={
				selection.card.autoReviewEnabled === true
					? getTaskAutoReviewCancelButtonLabel(selection.card.autoReviewMode)
					: null
			}
		/>
	) : (
		<AgentTerminalPanel
			taskId={selection.card.id}
			workspaceId={currentProjectId}
			terminalEnabled={isTaskTerminalEnabled}
			summary={sessionSummary}
			onSummary={onSessionSummary}
			onCommit={onAgentCommitTask ? () => onAgentCommitTask(selection.card.id) : undefined}
			onOpenPr={onAgentOpenPrTask ? () => onAgentOpenPrTask(selection.card.id) : undefined}
			isCommitLoading={agentCommitTaskLoadingById?.[selection.card.id] ?? false}
			isOpenPrLoading={agentOpenPrTaskLoadingById?.[selection.card.id] ?? false}
			showSessionToolbar={false}
			autoFocus
			showMoveToTrash={showMoveToTrashActions}
			onMoveToTrash={onMoveToTrash}
			isMoveToTrashLoading={isMoveToTrashLoading}
			moveToTrashButtonLabel={finishTaskButtonLabel}
			moveToTrashButtonVariant={finishTaskButtonVariant}
			onCancelAutomaticAction={
				selection.card.autoReviewEnabled === true && onCancelAutomaticTaskAction
					? () => onCancelAutomaticTaskAction(selection.card.id)
					: undefined
			}
			cancelAutomaticActionLabel={
				selection.card.autoReviewEnabled === true
					? getTaskAutoReviewCancelButtonLabel(selection.card.autoReviewMode)
					: null
			}
			panelBackgroundColor="var(--color-surface-0)"
			terminalBackgroundColor={terminalThemeColors.surfacePrimary}
			cursorColor={terminalThemeColors.textPrimary}
			taskColumnId={selection.column.id}
		/>
	);

	if (isMobile) {
		return (
			<div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-surface-0">
				<MobileDetailTabBar activeTab={mobileTab} onTabChange={setMobileTab} />
				<div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
					<div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
						{/* Chat panel */}
						<div
							className="min-h-0 min-w-0 flex-1 flex-col"
							style={{ display: mobileTab === "chat" ? "flex" : "none" }}
						>
							{agentChatPanel}
						</div>
						{/* Diff panel */}
						<div
							className="min-h-0 min-w-0 flex-1 flex-col"
							style={{ display: mobileTab === "diff" ? "flex" : "none" }}
						>
							{isRuntimeAvailable ? (
								<DiffToolbar
									mode={diffMode}
									onModeChange={setDiffMode}
									isExpanded={false}
									onToggleExpand={handleToggleDiffExpand}
									hideExpand
								/>
							) : null}
							<TaskActivitySurface
								selection={selection}
								sessionSummary={sessionSummary}
								workspaceId={currentProjectId}
							/>
							<PlanningDagReviewPanel selection={selection} dependencies={dependencies} />
							<TaskDiagnosticsPanel workspaceId={currentProjectId} taskId={selection.card.id} />
							<div className="flex min-h-0 flex-1">
								{isWorkspaceChangesPending ? (
									<WorkspaceChangesLoadingPanel panelFlex="1 1 0" />
								) : hasNoWorkspaceFileChanges ? (
									<WorkspaceChangesEmptyPanel title={emptyDiffTitle} />
								) : (
									<DiffViewerPanel
										workspaceFiles={isRuntimeAvailable ? runtimeFiles : null}
										selectedPath={selectedPath}
										onSelectedPathChange={setSelectedPath}
										viewMode="unified"
										onAddToTerminal={
											onAddReviewComments || showClineAgentChatPanel ? handleAddDiffComments : undefined
										}
										onSendToTerminal={
											onSendReviewComments || showClineAgentChatPanel ? handleSendDiffComments : undefined
										}
										comments={diffComments}
										onCommentsChange={setDiffComments}
									/>
								)}
							</div>
						</div>
						{/* Files panel */}
						<div
							className="min-h-0 min-w-0 flex-1 flex-col"
							style={{ display: mobileTab === "files" ? "flex" : "none" }}
						>
							<FileTreePanel
								workspaceFiles={isRuntimeAvailable ? runtimeFiles : null}
								selectedPath={selectedPath}
								onSelectPath={(path: string) => {
									setSelectedPath(path);
									setMobileTab("diff");
								}}
								panelFlex="1 1 0"
							/>
						</div>
					</div>
					{/* Terminal panel — bottom overlay */}
					{showBottomTerminal ? (
						<div className="absolute bottom-0 left-0 right-0 z-20">
							<BottomTerminalSection
								taskId={bottomTerminalTaskId}
								workspaceId={currentProjectId}
								summary={bottomTerminalSummary}
								onSummary={onSessionSummary}
								onClose={onBottomTerminalClose}
								subtitle={bottomTerminalSubtitle}
								terminalThemeColors={terminalThemeColors}
								onConnectionReady={onBottomTerminalConnectionReady}
								agentCommand={bottomTerminalAgentCommand}
								onSendAgentCommand={onBottomTerminalSendAgentCommand}
								paneHeight={bottomTerminalPaneHeight}
								onPaneHeightChange={onBottomTerminalPaneHeightChange}
								onCollapse={onBottomTerminalCollapse}
								isExpanded={isBottomTerminalExpanded}
								onToggleExpand={onBottomTerminalToggleExpand}
							/>
						</div>
					) : null}
				</div>
			</div>
		);
	}

	return (
		<div ref={detailLayoutRef} className="flex min-h-0 flex-1 overflow-hidden bg-surface-0">
			{!isDiffExpanded ? (
				<>
					<div className="flex min-h-0 min-w-0" style={{ width: taskCardsPanelPercent }}>
						<ColumnContextPanel
							selection={selection}
							workspacePath={workspacePath}
							onCardSelect={onCardSelect}
							taskSessions={taskSessions}
							onTaskDragEnd={onTaskDragEnd}
							onCreateTask={onCreateTask}
							onStartTask={onStartTask}
							onStartAllTasks={onStartAllTasks}
							onClearTrash={onClearTrash}
							editingTaskId={editingTaskId}
							inlineTaskEditor={inlineTaskEditor}
							onEditTask={onEditTask}
							onSaveTaskTitle={onSaveTaskTitle}
							onCommitTask={onCommitTask}
							onOpenPrTask={onOpenPrTask}
							onMoveToTrashTask={onMoveReviewCardToTrash}
							onRestoreFromTrashTask={onRestoreTaskFromTrash}
							commitTaskLoadingById={commitTaskLoadingById}
							openPrTaskLoadingById={openPrTaskLoadingById}
							moveToTrashLoadingById={moveToTrashLoadingById}
							panelWidth="100%"
							defaultClineModelId={runtimeConfig?.clineProviderSettings?.modelId ?? null}
						/>
					</div>
					<ResizeHandle
						orientation="vertical"
						ariaLabel="Resize task cards and detail panels"
						onMouseDown={handleSeparatorMouseDown}
						className="z-10"
					/>
				</>
			) : null}
			<div
				className="flex min-h-0 min-w-0 flex-col overflow-hidden"
				style={{ width: isDiffExpanded ? "100%" : detailContentPanelPercent }}
			>
				{gitHistoryPanel ? (
					<div className="flex min-h-0 flex-1 overflow-hidden">{gitHistoryPanel}</div>
				) : (
					<>
						<div ref={mainRowRef} className="flex min-h-0 flex-1 overflow-hidden">
							<div
								className="min-h-0 min-w-0"
								style={{ display: isDiffExpanded ? "none" : "flex", width: agentPanelPercent }}
							>
								{agentChatPanel}
							</div>
							{!isDiffExpanded ? (
								<ResizeHandle
									orientation="vertical"
									ariaLabel="Resize agent and diff panels"
									onMouseDown={handleAgentDiffSeparatorMouseDown}
									className="z-10"
								/>
							) : null}
							<div
								className="flex min-h-0 min-w-0 flex-col"
								style={{ width: isDiffExpanded ? "100%" : diffPanelPercent }}
							>
								{isRuntimeAvailable ? (
									<DiffToolbar
										mode={diffMode}
										onModeChange={setDiffMode}
										isExpanded={isDiffExpanded}
										onToggleExpand={handleToggleDiffExpand}
									/>
								) : null}
								<TaskActivitySurface
									selection={selection}
									sessionSummary={sessionSummary}
									workspaceId={currentProjectId}
								/>
								<PlanningDagReviewPanel selection={selection} dependencies={dependencies} />
								<TaskDiagnosticsPanel workspaceId={currentProjectId} taskId={selection.card.id} />
								<div className="flex min-h-0 flex-1">
									{isWorkspaceChangesPending ? (
										<WorkspaceChangesLoadingPanel panelFlex={detailDiffFileTreePanelFlex} />
									) : hasNoWorkspaceFileChanges ? (
										<WorkspaceChangesEmptyPanel title={emptyDiffTitle} />
									) : (
										<div ref={detailDiffRowRef} className="flex min-w-0 flex-1">
											<div
												className="flex min-h-0 min-w-0"
												style={{ flex: `0 0 ${detailDiffContentPanelPercent}` }}
											>
												<DiffViewerPanel
													workspaceFiles={isRuntimeAvailable ? runtimeFiles : null}
													selectedPath={selectedPath}
													onSelectedPathChange={setSelectedPath}
													viewMode={isDiffExpanded ? "split" : "unified"}
													onAddToTerminal={
														onAddReviewComments || showClineAgentChatPanel
															? handleAddDiffComments
															: undefined
													}
													onSendToTerminal={
														onSendReviewComments || showClineAgentChatPanel
															? handleSendDiffComments
															: undefined
													}
													comments={diffComments}
													onCommentsChange={setDiffComments}
												/>
											</div>
											<ResizeHandle
												orientation="vertical"
												ariaLabel="Resize detail diff panels"
												onMouseDown={handleDetailDiffSeparatorMouseDown}
												className="z-10"
											/>
											<div
												className="flex min-h-0 min-w-0"
												style={{ flex: `0 0 ${detailDiffFileTreePanelPercent}` }}
											>
												<FileTreePanel
													workspaceFiles={isRuntimeAvailable ? runtimeFiles : null}
													selectedPath={selectedPath}
													onSelectPath={setSelectedPath}
													panelFlex="1 1 0"
												/>
											</div>
										</div>
									)}
								</div>
							</div>
						</div>
						{bottomTerminalOpen && bottomTerminalTaskId ? (
							<BottomTerminalSection
								taskId={bottomTerminalTaskId}
								workspaceId={currentProjectId}
								summary={bottomTerminalSummary}
								onSummary={onSessionSummary}
								onClose={onBottomTerminalClose}
								subtitle={bottomTerminalSubtitle}
								terminalThemeColors={terminalThemeColors}
								onConnectionReady={onBottomTerminalConnectionReady}
								agentCommand={bottomTerminalAgentCommand}
								onSendAgentCommand={onBottomTerminalSendAgentCommand}
								paneHeight={bottomTerminalPaneHeight}
								onPaneHeightChange={onBottomTerminalPaneHeightChange}
								onCollapse={onBottomTerminalCollapse}
								isExpanded={isBottomTerminalExpanded}
								onToggleExpand={onBottomTerminalToggleExpand}
							/>
						) : null}
					</>
				)}
			</div>
		</div>
	);
}

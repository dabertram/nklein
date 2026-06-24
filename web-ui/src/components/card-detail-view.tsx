import type { DropResult } from "@hello-pangea/dnd";
import { acceptanceFailureCategoryLabel } from "@runtime-contract";
import {
	Activity,
	Check,
	Clipboard,
	Eye,
	Files,
	GitCompareArrows,
	Maximize2,
	MessageSquare,
	Minimize2,
	Trash2,
	X,
} from "lucide-react";
import type { MouseEvent as ReactMouseEvent, ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useHotkeys } from "react-hotkeys-hook";
import { showAppToast } from "@/components/app-toaster";
import { AgentTerminalPanel } from "@/components/detail-panels/agent-terminal-panel";
import { AgentWatchPanel } from "@/components/detail-panels/agent-watch-panel";
import { ColumnContextPanel } from "@/components/detail-panels/column-context-panel";
import { type DiffLineComment, DiffViewerPanel } from "@/components/detail-panels/diff-viewer-panel";
import { FileTreePanel } from "@/components/detail-panels/file-tree-panel";
import { FocusChainPanel } from "@/components/detail-panels/focus-chain-panel";
import {
	NKleinAgentChatPanel,
	type NKleinAgentChatPanelHandle,
} from "@/components/detail-panels/nklein-agent-chat-panel";
import { PlanningDagReviewPanel } from "@/components/detail-panels/planning-dag-review-panel";
import { SecondOpinionReviewPanel } from "@/components/detail-panels/second-opinion-review-panel";
import { buildTaskActivitySteps, getActivityToneClassName } from "@/components/detail-panels/task-activity-model";
import { TaskDiagnosticsPanel } from "@/components/detail-panels/task-diagnostics-panel";
import { TaskEvidenceDrawer } from "@/components/detail-panels/task-evidence-drawer";
import {
	WorkspaceChangesEmptyPanel,
	WorkspaceChangesLoadingPanel,
} from "@/components/detail-panels/workspace-changes-skeleton";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { ElementTooltip } from "@/components/ui/element-tooltip";
import { Spinner } from "@/components/ui/spinner";
import { useIsMobile } from "@/hooks/use-is-mobile";
import type { NKleinChatActionResult } from "@/hooks/use-nklein-chat-runtime-actions";
import type { NKleinChatMessage } from "@/hooks/use-nklein-chat-session";
import { ResizableBottomPane } from "@/resize/resizable-bottom-pane";
import { ResizeHandle } from "@/resize/resize-handle";
import { useCardDetailLayout } from "@/resize/use-card-detail-layout";
import { useResizeDrag } from "@/resize/use-resize-drag";
import { isNativeNKleinAgentSelected } from "@/runtime/native-agent";
import {
	applyNKleinPlanArtifact,
	collectTaskEvidence,
	fetchNKleinPlanArtifacts,
	fetchTaskDiagnostics,
	mergeTaskWorktrees,
	rejectNKleinPlanArtifact,
	verifyTaskAcceptance,
} from "@/runtime/runtime-config-query";
import type {
	RuntimeAgentId,
	RuntimeConfigResponse,
	RuntimeNKleinPlanArtifactSummary,
	RuntimeNKleinReasoningEffort,
	RuntimeNKleinTeamProgressEvent,
	RuntimeProtectedTestApprovalPayload,
	RuntimeTaskAcceptanceVerifyResponse,
	RuntimeTaskDiagnosticEvent,
	RuntimeTaskEvidenceResponse,
	RuntimeTaskSessionMode,
	RuntimeTaskSessionSummary,
	RuntimeTaskWorktreeMergeResponse,
	RuntimeWorkspaceChangesMode,
	RuntimeWorkspaceStateResponse,
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

function formatArtifactTimestamp(value: number): string {
	if (value <= 0) {
		return "Unknown time";
	}
	return new Date(value).toLocaleString();
}

function PendingPlanArtifactsPanel({
	workspaceId,
	taskId,
	onWorkspaceStateApplied,
}: {
	workspaceId: string | null;
	taskId: string;
	onWorkspaceStateApplied?: (state: RuntimeWorkspaceStateResponse) => void;
}): React.ReactElement | null {
	const [artifacts, setArtifacts] = useState<RuntimeNKleinPlanArtifactSummary[]>([]);
	const [isLoading, setIsLoading] = useState(false);
	const [actionArtifactId, setActionArtifactId] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		let cancelled = false;
		if (!workspaceId) {
			setArtifacts([]);
			setError(null);
			return;
		}
		setIsLoading(true);
		setError(null);
		void fetchNKleinPlanArtifacts(workspaceId, taskId)
			.then((response) => {
				if (!cancelled) {
					setArtifacts(response.artifacts);
				}
			})
			.catch((fetchError: unknown) => {
				if (!cancelled) {
					setError(fetchError instanceof Error ? fetchError.message : "Could not load pending plan artifacts.");
				}
			})
			.finally(() => {
				if (!cancelled) {
					setIsLoading(false);
				}
			});
		return () => {
			cancelled = true;
		};
	}, [taskId, workspaceId]);

	const handleApply = useCallback(
		async (artifactId: string) => {
			if (!workspaceId) {
				return;
			}
			setActionArtifactId(artifactId);
			setError(null);
			try {
				const response = await applyNKleinPlanArtifact(workspaceId, artifactId);
				onWorkspaceStateApplied?.(response.workspaceState);
				setArtifacts((current) => current.filter((artifact) => artifact.artifactId !== artifactId));
				showAppToast({ intent: "success", message: response.message, timeout: 5000 });
			} catch (applyError) {
				const message = applyError instanceof Error ? applyError.message : "Could not apply plan artifact.";
				setError(message);
				showAppToast({ intent: "danger", icon: "warning-sign", message, timeout: 7000 });
			} finally {
				setActionArtifactId(null);
			}
		},
		[onWorkspaceStateApplied, workspaceId],
	);

	const handleReject = useCallback(
		async (artifactId: string) => {
			if (!workspaceId) {
				return;
			}
			setActionArtifactId(artifactId);
			setError(null);
			try {
				const response = await rejectNKleinPlanArtifact(workspaceId, artifactId);
				setArtifacts((current) => current.filter((artifact) => artifact.artifactId !== artifactId));
				showAppToast({ intent: "success", message: response.message, timeout: 5000 });
			} catch (rejectError) {
				const message = rejectError instanceof Error ? rejectError.message : "Could not reject plan artifact.";
				setError(message);
				showAppToast({ intent: "danger", icon: "warning-sign", message, timeout: 7000 });
			} finally {
				setActionArtifactId(null);
			}
		},
		[workspaceId],
	);

	if (artifacts.length === 0 && !isLoading && !error) {
		return null;
	}

	return (
		<div className="border-b border-border bg-surface-1 px-3 py-2">
			<div className="mb-2 flex min-w-0 items-center gap-2 text-[12px] font-medium text-text-primary">
				<Activity size={14} className="shrink-0 text-text-secondary" />
				<span>Pending plan artifacts</span>
				<span className="truncate text-text-tertiary">
					{artifacts.length > 0 ? `${artifacts.length} ready` : isLoading ? "Loading" : "Needs attention"}
				</span>
				{isLoading ? <Spinner size={12} className="ml-auto" /> : null}
			</div>
			{error ? <div className="mb-2 text-[12px] text-status-red">{error}</div> : null}
			<div className="space-y-2">
				{artifacts.map((artifact) => {
					const isBusy = actionArtifactId === artifact.artifactId;
					return (
						<div key={artifact.artifactId} className="rounded-md border border-border bg-surface-0 px-2 py-2">
							<div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
								<div className="min-w-0">
									<div className="truncate text-[13px] font-medium text-text-primary">{artifact.title}</div>
									<div className="mt-1 text-[11px] text-text-secondary">
										{artifact.taskCount} tasks, {artifact.dependencyCount} dependencies ·{" "}
										{formatArtifactTimestamp(artifact.createdAt)}
									</div>
								</div>
								<div className="flex shrink-0 items-center gap-1">
									<Button
										size="sm"
										variant="primary"
										icon={isBusy ? <Spinner size={14} /> : <Check size={14} />}
										disabled={isBusy || actionArtifactId !== null}
										onClick={() => {
											void handleApply(artifact.artifactId);
										}}
									>
										Apply
									</Button>
									<ElementTooltip id="card-artifact.reject" side="top">
										<Button
											size="sm"
											variant="ghost"
											icon={<Trash2 size={14} />}
											disabled={isBusy || actionArtifactId !== null}
											onClick={() => {
												void handleReject(artifact.artifactId);
											}}
										>
											Reject
										</Button>
									</ElementTooltip>
								</div>
							</div>
						</div>
					);
				})}
			</div>
		</div>
	);
}

function hasAcceptanceCheck(prompt: string): boolean {
	return /^Acceptance check:\s*(.+?)\s*$/im.test(prompt);
}

function formatVerifyResult(response: RuntimeTaskAcceptanceVerifyResponse): string {
	const { acceptance } = response;
	const output = acceptance.output.trim();
	const outputPreview = output ? ` ${output.slice(0, 240)}` : "";
	const failureLine =
		acceptance.passed === false && (acceptance.failureCategory || acceptance.failureHint)
			? `\n${acceptanceFailureCategoryLabel(acceptance.failureCategory)}${acceptance.failureHint ? ` — ${acceptance.failureHint}` : ""}`
			: "";
	return `${response.message}${failureLine}${outputPreview}`;
}

function formatMergeResult(response: RuntimeTaskWorktreeMergeResponse): string {
	if (response.conflict) {
		const paths = response.conflict.conflictedPaths.join(", ");
		return paths ? `${response.message} ${paths}` : response.message;
	}
	return response.message;
}

function TaskRecoveryActionsPanel({
	workspaceId,
	selection,
	sessionSummary,
	onMarkTaskInterrupted,
}: {
	workspaceId: string | null;
	selection: CardSelection;
	sessionSummary: RuntimeTaskSessionSummary | null;
	onMarkTaskInterrupted?: (taskId: string) => Promise<{ ok: boolean; message?: string }>;
}): React.ReactElement | null {
	const canVerify =
		(selection.column.id === "planning" || selection.column.id === "review") &&
		hasAcceptanceCheck(selection.card.prompt);
	const canMerge = selection.column.id === "review";
	const canMarkInterrupted =
		sessionSummary?.heartbeatStatus === "lost" &&
		sessionSummary.state !== "interrupted" &&
		Boolean(onMarkTaskInterrupted);
	const canCollectEvidence = Boolean(workspaceId);
	const [verifyResult, setVerifyResult] = useState<string | null>(null);
	const [mergeResult, setMergeResult] = useState<string | null>(null);
	const [interruptResult, setInterruptResult] = useState<string | null>(null);
	const [evidenceResult, setEvidenceResult] = useState<string | null>(null);
	const [evidenceDetails, setEvidenceDetails] = useState<RuntimeTaskEvidenceResponse | null>(null);
	const [isVerifying, setIsVerifying] = useState(false);
	const [isMerging, setIsMerging] = useState(false);
	const [isMarkingInterrupted, setIsMarkingInterrupted] = useState(false);
	const [isCollectingEvidence, setIsCollectingEvidence] = useState(false);

	useEffect(() => {
		setVerifyResult(null);
		setMergeResult(null);
		setInterruptResult(null);
		setEvidenceResult(null);
		setEvidenceDetails(null);
	}, [selection.card.id]);

	const handleVerify = useCallback(async () => {
		if (!workspaceId) {
			return;
		}
		setIsVerifying(true);
		setVerifyResult(null);
		try {
			const response = await verifyTaskAcceptance(workspaceId, selection.card.id);
			setVerifyResult(formatVerifyResult(response));
			showAppToast({
				intent: response.ok ? "success" : "warning",
				message: response.message,
				timeout: 6000,
			});
		} catch (error) {
			const message = error instanceof Error ? error.message : "Could not verify this task.";
			setVerifyResult(message);
			showAppToast({ intent: "danger", icon: "warning-sign", message, timeout: 7000 });
		} finally {
			setIsVerifying(false);
		}
	}, [selection.card.id, workspaceId]);

	const handleMerge = useCallback(async () => {
		if (!workspaceId) {
			return;
		}
		setIsMerging(true);
		setMergeResult(null);
		try {
			const response = await mergeTaskWorktrees(workspaceId, selection.card.id);
			setMergeResult(formatMergeResult(response));
			showAppToast({
				intent: response.ok ? "success" : "warning",
				message: response.message,
				timeout: 7000,
			});
		} catch (error) {
			const message = error instanceof Error ? error.message : "Could not merge this task result.";
			setMergeResult(message);
			showAppToast({ intent: "danger", icon: "warning-sign", message, timeout: 7000 });
		} finally {
			setIsMerging(false);
		}
	}, [selection.card.id, workspaceId]);

	const handleMarkInterrupted = useCallback(async () => {
		if (!onMarkTaskInterrupted) {
			return;
		}
		setIsMarkingInterrupted(true);
		setInterruptResult(null);
		try {
			const response = await onMarkTaskInterrupted(selection.card.id);
			if (!response.ok) {
				const message = response.message ?? "Could not mark this task interrupted.";
				setInterruptResult(message);
				showAppToast({ intent: "danger", icon: "warning-sign", message, timeout: 7000 });
				return;
			}
			const message = "Marked the lost task session interrupted.";
			setInterruptResult(message);
			showAppToast({ intent: "success", message, timeout: 4000 });
		} catch (error) {
			const message = error instanceof Error ? error.message : "Could not mark this task interrupted.";
			setInterruptResult(message);
			showAppToast({ intent: "danger", icon: "warning-sign", message, timeout: 7000 });
		} finally {
			setIsMarkingInterrupted(false);
		}
	}, [onMarkTaskInterrupted, selection.card.id]);

	const handleCollectEvidence = useCallback(async () => {
		if (!workspaceId) {
			return;
		}
		setIsCollectingEvidence(true);
		setEvidenceResult(null);
		try {
			const response = await collectTaskEvidence(workspaceId, selection.card.id);
			await navigator.clipboard.writeText(response.promptBlock);
			const message = `Evidence created and copied. ${response.bundlePath}`;
			setEvidenceResult(message);
			setEvidenceDetails(response);
			showAppToast({ intent: "success", icon: "clipboard", message: "Evidence created and copied.", timeout: 5000 });
		} catch (error) {
			const message = error instanceof Error ? error.message : "Could not collect task evidence.";
			setEvidenceResult(message);
			setEvidenceDetails(null);
			showAppToast({ intent: "danger", icon: "warning-sign", message, timeout: 7000 });
		} finally {
			setIsCollectingEvidence(false);
		}
	}, [selection.card.id, workspaceId]);

	if (!canVerify && !canMerge && !canMarkInterrupted && !canCollectEvidence) {
		return null;
	}

	return (
		<div className="border-b border-border bg-surface-1 px-3 py-2">
			<div className="mb-2 flex min-w-0 items-center gap-2 text-[12px] font-medium text-text-primary">
				<GitCompareArrows size={14} className="shrink-0 text-text-secondary" />
				<span>Review actions</span>
				<span className="truncate text-text-tertiary">Verify, merge, recover, or create evidence</span>
			</div>
			<div className="flex flex-wrap gap-2">
				{canCollectEvidence ? (
					<Button
						size="sm"
						variant="default"
						icon={isCollectingEvidence ? <Spinner size={14} /> : <Clipboard size={14} />}
						disabled={isVerifying || isMerging || isMarkingInterrupted || isCollectingEvidence}
						onClick={() => {
							void handleCollectEvidence();
						}}
					>
						Create evidence
					</Button>
				) : null}
				{canVerify ? (
					<Button
						size="sm"
						variant="default"
						icon={isVerifying ? <Spinner size={14} /> : <Check size={14} />}
						disabled={!workspaceId || isVerifying || isMerging || isMarkingInterrupted || isCollectingEvidence}
						onClick={() => {
							void handleVerify();
						}}
					>
						Verify
					</Button>
				) : null}
				{canMerge ? (
					<Button
						size="sm"
						variant="default"
						icon={isMerging ? <Spinner size={14} /> : <GitCompareArrows size={14} />}
						disabled={!workspaceId || isVerifying || isMerging || isMarkingInterrupted || isCollectingEvidence}
						onClick={() => {
							void handleMerge();
						}}
					>
						Merge
					</Button>
				) : null}
				{canMarkInterrupted ? (
					<Button
						size="sm"
						variant="default"
						icon={isMarkingInterrupted ? <Spinner size={14} /> : <X size={14} />}
						disabled={isVerifying || isMerging || isMarkingInterrupted || isCollectingEvidence}
						onClick={() => {
							void handleMarkInterrupted();
						}}
					>
						Mark interrupted
					</Button>
				) : null}
			</div>
			{verifyResult ? (
				<div className="mt-2 whitespace-pre-line text-[12px] text-text-secondary">{verifyResult}</div>
			) : null}
			{mergeResult ? <div className="mt-2 text-[12px] text-text-secondary">{mergeResult}</div> : null}
			{interruptResult ? <div className="mt-2 text-[12px] text-text-secondary">{interruptResult}</div> : null}
			{evidenceResult ? (
				<div className="mt-2 break-all text-[12px] text-text-secondary">{evidenceResult}</div>
			) : null}
			{evidenceDetails ? <TaskEvidenceDrawer evidence={evidenceDetails} /> : null}
		</div>
	);
}

type MobileTab = "chat" | "watch" | "diff" | "files";

const MOBILE_TABS: { id: MobileTab; label: string; icon: React.ReactElement }[] = [
	{ id: "chat", label: "Chat", icon: <MessageSquare size={14} /> },
	{ id: "watch", label: "Watch", icon: <Eye size={14} /> },
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
				<ElementTooltip id="card-diff.collapse-expanded" side="top">
					<Button
						variant="ghost"
						size="sm"
						icon={<X size={14} />}
						onClick={onToggleExpand}
						className="h-5"
						aria-label="Collapse expanded diff view"
					/>
				</ElementTooltip>
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
				<ElementTooltip id="card-diff.toggle-split" side="top">
					<Button
						variant="ghost"
						size="sm"
						icon={isExpanded ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
						onClick={onToggleExpand}
						className="ml-auto h-5"
						aria-label={isExpanded ? "Collapse split diff view" : "Expand split diff view"}
					/>
				</ElementTooltip>
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
	onUpdateFocusChain,
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
	onSendNKleinChatMessage,
	onCancelNKleinChatTurn,
	onGrantProtectedTestApproval,
	onMarkTaskInterrupted,
	onLoadNKleinChatMessages,
	latestNKleinChatMessage,
	streamedNKleinChatMessages,
	nkleinTeamProgress,
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
	onNKleinSettingsSaved,
	onTaskNKleinSettingsChanged,
	onApprovePlanningCard,
	onWorkspaceStateApplied,
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
	onUpdateFocusChain?: (taskId: string, focusChain: BoardCard["focusChain"] | null) => void;
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
	onSendNKleinChatMessage?: (
		taskId: string,
		text: string,
		options?: { mode?: RuntimeTaskSessionMode },
	) => Promise<NKleinChatActionResult>;
	onCancelNKleinChatTurn?: (taskId: string) => Promise<{ ok: boolean; message?: string }>;
	onGrantProtectedTestApproval?: (
		taskId: string,
		approval: RuntimeProtectedTestApprovalPayload,
	) => Promise<NKleinChatActionResult>;
	onMarkTaskInterrupted?: (taskId: string) => Promise<{ ok: boolean; message?: string }>;
	onLoadNKleinChatMessages?: (taskId: string) => Promise<NKleinChatMessage[] | null>;
	latestNKleinChatMessage?: NKleinChatMessage | null;
	streamedNKleinChatMessages?: NKleinChatMessage[] | null;
	nkleinTeamProgress?: RuntimeNKleinTeamProgressEvent[];
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
	onNKleinSettingsSaved?: () => void;
	onTaskNKleinSettingsChanged?: (settings: {
		providerId: string;
		modelId: string;
		reasoningEffort: RuntimeNKleinReasoningEffort | "";
		contextScope: "full" | "smart" | "minimal" | "custom";
		timeoutMode: "normal" | "long" | "extended" | "unlimited";
	}) => void;
	onApprovePlanningCard?: (taskId: string) => void;
	onWorkspaceStateApplied?: (state: RuntimeWorkspaceStateResponse) => void;
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
	const hasExplicitTaskNKleinSettings =
		selection.card.agentId === "nklein" || selection.card.nkleinSettings !== undefined;
	const mainRowRef = useRef<HTMLDivElement | null>(null);
	const detailDiffRowRef = useRef<HTMLDivElement | null>(null);
	const nkleinAgentChatPanelRef = useRef<NKleinAgentChatPanelHandle | null>(null);

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
	const showNKleinAgentChatPanel = isNativeNKleinAgentSelected(effectiveTaskAgentId);
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
			if (showNKleinAgentChatPanel) {
				nkleinAgentChatPanelRef.current?.appendToDraft(formatted);
				setIsDiffExpanded(false);
				return;
			}
			onAddReviewComments?.(selection.card.id, formatted);
		},
		[onAddReviewComments, selection.card.id, showNKleinAgentChatPanel],
	);

	const handleSendDiffComments = useCallback(
		(formatted: string) => {
			if (showNKleinAgentChatPanel) {
				void nkleinAgentChatPanelRef.current?.sendText(formatted);
				setIsDiffExpanded(false);
				return;
			}
			onSendReviewComments?.(selection.card.id, formatted);
			setIsDiffExpanded(false);
		},
		[onSendReviewComments, selection.card.id, showNKleinAgentChatPanel],
	);

	const showBottomTerminal = bottomTerminalOpen && !!bottomTerminalTaskId;

	const agentChatPanel = showNKleinAgentChatPanel ? (
		<NKleinAgentChatPanel
			ref={nkleinAgentChatPanelRef}
			taskId={selection.card.id}
			summary={sessionSummary}
			taskColumnId={selection.column.id}
			defaultMode="act"
			showComposerModeToggle={false}
			workspaceId={currentProjectId}
			taskTitle={selection.card.title}
			taskPrompt={selection.card.prompt}
			runtimeConfig={runtimeConfig}
			taskNKleinSettings={selection.card.nkleinSettings}
			taskHasExplicitNKleinSettings={hasExplicitTaskNKleinSettings}
			onNKleinSettingsSaved={onNKleinSettingsSaved}
			onTaskNKleinSettingsChanged={onTaskNKleinSettingsChanged}
			onSendMessage={onSendNKleinChatMessage}
			onCancelTurn={onCancelNKleinChatTurn}
			onLoadMessages={onLoadNKleinChatMessages}
			onGrantProtectedTestApproval={onGrantProtectedTestApproval}
			incomingMessages={streamedNKleinChatMessages}
			incomingMessage={latestNKleinChatMessage}
			teamProgress={nkleinTeamProgress}
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
						{/* Watch panel — "watch the agent's hands" */}
						<div
							className="min-h-0 min-w-0 flex-1 flex-col"
							style={{ display: mobileTab === "watch" ? "flex" : "none" }}
						>
							<AgentWatchPanel
								taskId={selection.card.id}
								workspaceId={currentProjectId}
								baseRef={selection.card.baseRef ?? null}
								summary={sessionSummary}
								stateVersion={taskWorkspaceStateVersion}
								onOpenTerminal={() => setMobileTab("chat")}
							/>
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
							<PlanningDagReviewPanel
								selection={selection}
								dependencies={dependencies}
								onApprovePlanningCard={onApprovePlanningCard}
							/>
							<TaskRecoveryActionsPanel
								workspaceId={currentProjectId}
								selection={selection}
								sessionSummary={sessionSummary}
								onMarkTaskInterrupted={onMarkTaskInterrupted}
							/>
							<FocusChainPanel selection={selection} onUpdate={onUpdateFocusChain} />
							<SecondOpinionReviewPanel selection={selection} />
							<PendingPlanArtifactsPanel
								workspaceId={currentProjectId}
								taskId={selection.card.id}
								onWorkspaceStateApplied={onWorkspaceStateApplied}
							/>
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
											onAddReviewComments || showNKleinAgentChatPanel ? handleAddDiffComments : undefined
										}
										onSendToTerminal={
											onSendReviewComments || showNKleinAgentChatPanel ? handleSendDiffComments : undefined
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
							defaultNKleinModelId={runtimeConfig?.nkleinProviderSettings?.modelId ?? null}
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
								<PlanningDagReviewPanel
									selection={selection}
									dependencies={dependencies}
									onApprovePlanningCard={onApprovePlanningCard}
								/>
								<TaskRecoveryActionsPanel
									workspaceId={currentProjectId}
									selection={selection}
									sessionSummary={sessionSummary}
									onMarkTaskInterrupted={onMarkTaskInterrupted}
								/>
								<FocusChainPanel selection={selection} onUpdate={onUpdateFocusChain} />
								<SecondOpinionReviewPanel selection={selection} />
								<PendingPlanArtifactsPanel
									workspaceId={currentProjectId}
									taskId={selection.card.id}
									onWorkspaceStateApplied={onWorkspaceStateApplied}
								/>
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
														onAddReviewComments || showNKleinAgentChatPanel
															? handleAddDiffComments
															: undefined
													}
													onSendToTerminal={
														onSendReviewComments || showNKleinAgentChatPanel
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

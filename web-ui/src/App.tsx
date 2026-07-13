// Main React composition root for the browser app.
// Keep this file focused on wiring top-level hooks and surfaces together, and
// push runtime-specific orchestration down into hooks and service modules.

import { summarizeBoardHealth } from "@runtime-operator-board-health";
import { FolderOpen, GitFork } from "lucide-react";
import type { ReactElement } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { composeActivityMap } from "@/components/activity-map-model";
import { ActivityMapView } from "@/components/activity-map-view";
import { AddProjectDialog } from "@/components/add-project-dialog";
import { notifyError, showAppToast } from "@/components/app-toaster";
import { BoardDagView } from "@/components/board-dag-view";
import { deriveReasoningSnippetByTask } from "@/components/board-reasoning-snippets";
import { CardDetailView } from "@/components/card-detail-view";
import { ChatPrimaryPane, ChatSidebar } from "@/components/chat/chat-sidebar";
import { ClearTrashDialog } from "@/components/clear-trash-dialog";
import { CommandPalette } from "@/components/command-palette";
import { DebugDialog } from "@/components/debug-dialog";
import { type DependencyPickerCard, DependencyPickerDialog } from "@/components/dependency-picker-dialog";
import { AgentTerminalPanel } from "@/components/detail-panels/agent-terminal-panel";
import { GitHistoryView } from "@/components/git-history-view";
import { KanbanBoard } from "@/components/kanban-board";
import { LeanBoardView } from "@/components/lean-board-view";
import { ProjectNavigationPanel } from "@/components/project-navigation-panel";
import { RuntimeSettingsDialog, type RuntimeSettingsSection } from "@/components/runtime-settings-dialog";
import { SetupWizardDialog } from "@/components/setup-wizard-dialog";
import { StartupOnboardingDialog } from "@/components/startup-onboarding-dialog";
import { TaskCreateDialog } from "@/components/task-create-dialog";
import { TaskInlineCreateCard } from "@/components/task-inline-create-card";
import { TopBar } from "@/components/top-bar";
import { Button } from "@/components/ui/button";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogBody,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { UpdateNotificationController } from "@/components/update-notification-controller";
import { WorkspaceConflictNotice } from "@/components/workspace-conflict-notice";
import { createInitialBoardData } from "@/data/board-data";
import { createIdleTaskSession } from "@/hooks/app-utils";
import { KanbanAccessBlockedFallback } from "@/hooks/kanban-access-blocked-fallback";
import { RuntimeDisconnectedFallback } from "@/hooks/runtime-disconnected-fallback";
import { useAppHotkeys } from "@/hooks/use-app-hotkeys";
import { useBoardActivityTicks } from "@/hooks/use-board-activity-ticks";
import { useBoardInteractions } from "@/hooks/use-board-interactions";
import { useDebugTools } from "@/hooks/use-debug-tools";
import { useDetailTaskNavigation } from "@/hooks/use-detail-task-navigation";
import { useDocumentVisibility } from "@/hooks/use-document-visibility";
import { useFeaturebaseFeedbackWidget } from "@/hooks/use-featurebase-feedback-widget";
import { useGitActions } from "@/hooks/use-git-actions";
import { useKanbanAccessGate } from "@/hooks/use-kanban-access-gate";
import { useOpenWorkspace } from "@/hooks/use-open-workspace";
import { parseRemovedProjectPathFromStreamError, useProjectNavigation } from "@/hooks/use-project-navigation";
import { useProjectUiState } from "@/hooks/use-project-ui-state";
import { useReviewReadyNotifications } from "@/hooks/use-review-ready-notifications";
import { useSetupWizard } from "@/hooks/use-setup-wizard";
import { useShortcutActions } from "@/hooks/use-shortcut-actions";
import { useStartupOnboarding } from "@/hooks/use-startup-onboarding";
import { useTaskBranchOptions } from "@/hooks/use-task-branch-options";
import { useTaskEditor } from "@/hooks/use-task-editor";
import { useTaskSessions } from "@/hooks/use-task-sessions";
import { useTaskStartActions } from "@/hooks/use-task-start-actions";
import { isShellTerminalTaskId, useTerminalPanels } from "@/hooks/use-terminal-panels";
import { useWorkspaceSync } from "@/hooks/use-workspace-sync";
import { useZoomLevel, ZOOM_LEVELS } from "@/hooks/use-zoom-level";
import { LayoutCustomizationsProvider } from "@/resize/layout-customizations";
import { ResizableBottomPane } from "@/resize/resizable-bottom-pane";
import { useProjectNavigationLayout } from "@/resize/use-project-navigation-layout";
import {
	getTaskAgentNavbarHint,
	isCloudProviderSupportEnabled,
	isTaskAgentSetupSatisfied,
	selectLatestTaskChatMessageForTask,
	selectTaskChatMessagesForTask,
} from "@/runtime/native-agent";
import { getRuntimeTrpcClient } from "@/runtime/trpc-client";
import type {
	RuntimeNKleinReasoningEffort,
	RuntimeTaskSessionSummary,
	RuntimeWorkspaceStateResponse,
} from "@/runtime/types";
import { useRuntimeProjectConfig } from "@/runtime/use-runtime-project-config";
import { useTerminalConnectionReady } from "@/runtime/use-terminal-connection-ready";
import { useWorkspacePersistence } from "@/runtime/use-workspace-persistence";
import { saveWorkspaceState } from "@/runtime/workspace-state-query";
import {
	applyTaskDetailNKleinSettingsChange,
	approvePlanningTaskForExecution,
	findCardSelection,
} from "@/state/board-state";
import {
	getTaskWorkspaceSnapshot,
	replaceWorkspaceMetadata,
	resetWorkspaceMetadataStore,
} from "@/stores/workspace-metadata-store";
import { useTerminalThemeColors } from "@/terminal/theme-colors";
import type { BoardData } from "@/types";

export default function App(): ReactElement {
	const terminalThemeColors = useTerminalThemeColors();
	const [board, setBoard] = useState<BoardData>(() => createInitialBoardData());
	// §5.BB: the zoom-level surface (0 chat · 1 overview · 2 lean · 3 expert · 4 professional).
	const { zoom, setZoom, streamFilter, zoomToStream } = useZoomLevel();
	const [sessions, setSessions] = useState<Record<string, RuntimeTaskSessionSummary>>({});
	// §5.BB: live board-activity ticks (pure snapshot diff) interleaved into the chat transcript.
	const activityTicks = useBoardActivityTicks(
		useMemo(() => ({ columns: board.columns, sessions }), [board.columns, sessions]),
	);
	// W3.4 needs-you badge: cards needing the operator (blocked / parked / attention-held), computed with the same
	// rollup the board-health summary uses so both tell one story. Rendered next to the zoom control at EVERY zoom
	// (the whole point: at chat/overview zooms the board's own summary is hidden).
	const needsYouCount = useMemo(() => {
		const health = summarizeBoardHealth(
			{ columns: board.columns.map((column) => ({ id: column.id, cards: column.cards })) },
			sessions,
			(taskId) => {
				const card = board.columns.flatMap((column) => column.cards).find((entry) => entry.id === taskId);
				return {
					blockedKind: card?.blockedKind ?? null,
					deliveryGateHeld: sessions[taskId]?.reviewReason === "attention",
				};
			},
		);
		return health.inbox.total;
	}, [board.columns, sessions]);
	// §5.BB map spotlight: the card whose chat chip is hovered — its bubble gets a ring on the activity map (Z1).
	const [chatHoverCardId, setChatHoverCardId] = useState<string | null>(null);
	// W3.4: the dedicated full-board dependency-graph view (pan/zoom, cycle edges marked).
	const [isDagViewOpen, setIsDagViewOpen] = useState(false);
	// §5.BB: the chat surfaces' board context (card chips + @-mention candidates), shared by the right rail
	// (zoom ≥ 1) and the zoom-0 chat-primary pane.
	const chatBoardCards = useMemo(
		() =>
			board.columns.flatMap((column) =>
				column.id === "trash" ? [] : column.cards.map((card) => ({ id: card.id, title: card.title })),
			),
		[board.columns],
	);
	const chatBoardStreams = useMemo(
		() =>
			[
				...new Set(
					board.columns.flatMap((column) =>
						column.id === "trash"
							? []
							: column.cards.flatMap((card) => card.generatedFromPlan?.planSlug?.trim() || []),
					),
				),
				// `stream-<slug>` matches the server's deriveStreams ids, so an inserted @stream:<id> resolves (§5.AU).
			].map((slug) => ({ id: `stream-${slug}`, title: slug.replaceAll(/[-_]+/g, " ") })),
		[board.columns],
	);
	const [canPersistWorkspaceState, setCanPersistWorkspaceState] = useState(false);
	const [isSettingsOpen, setIsSettingsOpen] = useState(false);
	const [settingsInitialSection, setSettingsInitialSection] = useState<RuntimeSettingsSection | null>(null);
	const [isClearTrashDialogOpen, setIsClearTrashDialogOpen] = useState(false);
	const [isGitHistoryOpen, setIsGitHistoryOpen] = useState(false);
	const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
	const [manageDependenciesCardId, setManageDependenciesCardId] = useState<string | null>(null);
	const [pendingTaskStartAfterEditId, setPendingTaskStartAfterEditId] = useState<string | null>(null);
	const taskEditorResetRef = useRef<() => void>(() => {});
	const lastStreamErrorRef = useRef<string | null>(null);
	const handleProjectSwitchStart = useCallback(() => {
		setCanPersistWorkspaceState(false);
		setIsGitHistoryOpen(false);
		setPendingTaskStartAfterEditId(null);
		taskEditorResetRef.current();
	}, []);
	const {
		currentProjectId,
		projects,
		workspaceState: streamedWorkspaceState,
		workspaceMetadata,
		latestTaskChatMessage,
		taskChatMessagesByTaskId,
		nkleinTeamProgressByTaskId,
		latestTaskReadyForReview,
		latestMcpAuthStatuses,
		streamError,
		isRuntimeDisconnected,
		hasReceivedSnapshot,
		navigationCurrentProjectId,
		removingProjectId,
		hasNoProjects,
		isProjectSwitching,
		handleSelectProject,
		handleAddProject,
		handleAddProjectSuccess,
		handleRemoveProject,
		isAddProjectDialogOpen,
		setIsAddProjectDialogOpen,
		pendingNativeGitInitPath,
		pendingNativeSelfProjectPath,
		resetProjectNavigationState,
	} = useProjectNavigation({
		onProjectSwitchStart: handleProjectSwitchStart,
	});
	const activeNotificationWorkspaceId = navigationCurrentProjectId;
	const isDocumentVisible = useDocumentVisibility();
	const isInitialRuntimeLoad =
		!hasReceivedSnapshot && currentProjectId === null && projects.length === 0 && !streamError;
	const isAwaitingWorkspaceSnapshot = currentProjectId !== null && streamedWorkspaceState === null;
	const {
		config: runtimeProjectConfig,
		isLoading: isRuntimeProjectConfigLoading,
		refresh: refreshRuntimeProjectConfig,
	} = useRuntimeProjectConfig(currentProjectId);
	const { isBlocked: isKanbanAccessBlocked, refresh: refreshKanbanAccess } = useKanbanAccessGate({
		workspaceId: currentProjectId,
	});
	const isTaskAgentReady = isTaskAgentSetupSatisfied(runtimeProjectConfig);
	const settingsWorkspaceId = navigationCurrentProjectId ?? currentProjectId;
	const { config: settingsRuntimeProjectConfig, refresh: refreshSettingsRuntimeProjectConfig } =
		useRuntimeProjectConfig(settingsWorkspaceId);
	const cloudProviderSupportEnabled = isCloudProviderSupportEnabled(settingsRuntimeProjectConfig);
	const featurebaseFeedbackState = useFeaturebaseFeedbackWidget({
		workspaceId: settingsWorkspaceId,
		nkleinProviderSettings: settingsRuntimeProjectConfig?.nkleinProviderSettings ?? null,
		cloudProviderSupportEnabled,
	});
	const {
		isStartupOnboardingDialogOpen,
		handleOpenStartupOnboardingDialog,
		handleCloseStartupOnboardingDialog,
		handleSelectOnboardingAgent,
		handleOnboardingNKleinSetupSaved,
	} = useStartupOnboarding({
		currentProjectId,
		runtimeProjectConfig,
		isRuntimeProjectConfigLoading,
		isTaskAgentReady,
		refreshRuntimeProjectConfig,
		refreshSettingsRuntimeProjectConfig,
	});
	// §5.BA guided-setup wizards. Two independent controllers (global, project). Precedence: the global wizard fires
	// first at startup; the project wizard is held back (autoFireSuppressed) while startup onboarding or the global
	// wizard is showing, so two modals never stack. The project wizard only fetches/auto-fires once a project is active.
	const globalSetupWizard = useSetupWizard({
		kind: "global",
		workspaceId: currentProjectId,
		enabled: true,
		autoFireSuppressed: isStartupOnboardingDialogOpen,
		onCompleted: () => {
			refreshRuntimeProjectConfig();
			refreshSettingsRuntimeProjectConfig();
		},
	});
	const projectSetupWizard = useSetupWizard({
		kind: "project",
		workspaceId: currentProjectId,
		enabled: currentProjectId !== null,
		autoFireSuppressed: isStartupOnboardingDialogOpen || globalSetupWizard.isOpen,
		onCompleted: () => {
			refreshRuntimeProjectConfig();
			refreshSettingsRuntimeProjectConfig();
		},
	});
	const {
		developerModeEnabled,
		isDebugDialogOpen,
		isResetAllStatePending,
		dataDirectoryPath,
		handleOpenDebugDialog,
		handleOpenDataDirectory,
		handleShowStartupOnboardingDialog,
		handleDebugDialogOpenChange,
		handleResetAllState,
	} = useDebugTools({
		runtimeProjectConfig,
		settingsRuntimeProjectConfig,
		onOpenStartupOnboardingDialog: handleOpenStartupOnboardingDialog,
	});
	const {
		markConnectionReady: markTerminalConnectionReady,
		prepareWaitForConnection: prepareWaitForTerminalConnectionReady,
	} = useTerminalConnectionReady();
	const readyForReviewNotificationsEnabled = runtimeProjectConfig?.readyForReviewNotificationsEnabled ?? true;
	const activeTaskSessionCount = useMemo(
		() =>
			Object.values(sessions).filter(
				(session) =>
					!isShellTerminalTaskId(session.taskId) &&
					(session.state === "queued" || session.state === "running" || session.state === "awaiting_review"),
			).length,
		[sessions],
	);
	const shortcuts = runtimeProjectConfig?.shortcuts ?? [];
	const selectedShortcutLabel = useMemo(() => {
		if (shortcuts.length === 0) {
			return null;
		}
		const configured = runtimeProjectConfig?.selectedShortcutLabel ?? null;
		if (configured && shortcuts.some((shortcut) => shortcut.label === configured)) {
			return configured;
		}
		return shortcuts[0]?.label ?? null;
	}, [runtimeProjectConfig?.selectedShortcutLabel, shortcuts]);
	const {
		upsertSession,
		startTaskSession,
		stopTaskSession,
		sendTaskSessionInput,
		sendTaskChatMessage,
		grantProtectedTestApproval,
		cancelTaskChatTurn,
		fetchTaskChatMessages,
		cleanupTaskArtifacts,
	} = useTaskSessions({
		currentProjectId,
		setSessions,
	});
	const markTaskInterrupted = useCallback(
		async (taskId: string): Promise<{ ok: boolean; message?: string }> => {
			if (!currentProjectId) {
				return { ok: false, message: "No project is selected." };
			}
			try {
				const payload = await getRuntimeTrpcClient(currentProjectId).runtime.stopTaskSession.mutate({ taskId });
				if (!payload.ok || !payload.summary) {
					return {
						ok: false,
						message: payload.error ?? "Could not mark the task interrupted.",
					};
				}
				upsertSession(payload.summary);
				return { ok: true };
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				return { ok: false, message };
			}
		},
		[currentProjectId, upsertSession],
	);

	const {
		workspacePath,
		workspaceGit,
		workspaceRevision,
		setWorkspaceRevision,
		workspaceHydrationNonce,
		isWorkspaceStateRefreshing,
		isWorkspaceMetadataPending,
		refreshWorkspaceState,
		resetWorkspaceSyncState,
	} = useWorkspaceSync({
		currentProjectId,
		streamedWorkspaceState,
		hasNoProjects,
		hasReceivedSnapshot,
		isDocumentVisible,
		setBoard,
		setSessions,
		setCanPersistWorkspaceState,
	});
	const { selectedTaskId, selectedCard, setSelectedTaskId, handleBack } = useDetailTaskNavigation({
		board,
		currentProjectId,
		isAwaitingWorkspaceSnapshot,
		isInitialRuntimeLoad,
		isProjectSwitching,
		isWorkspaceMetadataPending,
		onDetailClosed: () => {
			setIsGitHistoryOpen(false);
		},
	});
	const handleWorkspaceStateApplied = useCallback(
		(state: RuntimeWorkspaceStateResponse) => {
			setBoard(state.board);
			setSessions(state.sessions);
			setWorkspaceRevision(state.revision);
			setCanPersistWorkspaceState(true);
		},
		[setWorkspaceRevision],
	);

	useEffect(() => {
		replaceWorkspaceMetadata(workspaceMetadata);
	}, [workspaceMetadata]);

	useEffect(() => {
		if (!isProjectSwitching) {
			return;
		}
		resetWorkspaceMetadataStore();
	}, [isProjectSwitching]);

	const {
		displayedProjects,
		navigationProjectPath,
		shouldShowProjectLoadingState,
		isProjectListLoading,
		shouldUseNavigationPath,
	} = useProjectUiState({
		board,
		canPersistWorkspaceState,
		currentProjectId,
		projects,
		navigationCurrentProjectId,
		selectedTaskId,
		streamError,
		isProjectSwitching,
		isInitialRuntimeLoad,
		isAwaitingWorkspaceSnapshot,
		isWorkspaceMetadataPending,
		hasReceivedSnapshot,
	});

	useReviewReadyNotifications({
		activeWorkspaceId: activeNotificationWorkspaceId,
		board,
		isDocumentVisible,
		latestTaskReadyForReview,
		taskSessions: sessions,
		readyForReviewNotificationsEnabled,
		workspacePath,
	});

	const { createTaskBranchOptions, defaultTaskBranchRef } = useTaskBranchOptions({ workspaceGit });
	const queueTaskStartAfterEdit = useCallback((taskId: string) => {
		setPendingTaskStartAfterEditId(taskId);
	}, []);

	const {
		isInlineTaskCreateOpen,
		newTaskPrompt,
		setNewTaskPrompt,
		newTaskImages,
		setNewTaskImages,
		newTaskStartInPlanMode,
		setNewTaskStartInPlanMode,
		newTaskAutoReviewEnabled,
		setNewTaskAutoReviewEnabled,
		newTaskAutoReviewMode,
		setNewTaskAutoReviewMode,
		isNewTaskStartInPlanModeDisabled,
		newTaskBranchRef,
		setNewTaskBranchRef,
		newTaskAgentId,
		setNewTaskAgentId,
		newTaskNKleinSettings,
		setNewTaskNKleinSettings,
		editingTaskId,
		editTaskPrompt,
		setEditTaskPrompt,
		editTaskImages,
		setEditTaskImages,
		editTaskStartInPlanMode,
		setEditTaskStartInPlanMode,
		editTaskAutoReviewEnabled,
		setEditTaskAutoReviewEnabled,
		editTaskAutoReviewMode,
		setEditTaskAutoReviewMode,
		isEditTaskStartInPlanModeDisabled,
		editTaskBranchRef,
		setEditTaskBranchRef,
		editTaskAgentId,
		setEditTaskAgentId,
		editTaskNKleinSettings,
		setEditTaskNKleinSettings,
		handleOpenCreateTask,
		handleCancelCreateTask,
		handleOpenEditTask,
		handleCancelEditTask,
		handleSaveEditedTask,
		handleSaveAndStartEditedTask,
		handleSaveTaskTitle,
		handleUpdateTaskFocusChain,
		handleCreateTask,
		handleCreateTasks,
		resetTaskEditorState,
	} = useTaskEditor({
		board,
		setBoard,
		currentProjectId,
		createTaskBranchOptions,
		defaultTaskBranchRef,
		selectedAgentId: runtimeProjectConfig?.selectedAgentId ?? null,
		setSelectedTaskId,
		queueTaskStartAfterEdit,
	});

	useEffect(() => {
		taskEditorResetRef.current = resetTaskEditorState;
	}, [resetTaskEditorState]);

	useEffect(() => {
		if (!isProjectSwitching) {
			return;
		}
		resetWorkspaceSyncState();
	}, [isProjectSwitching, resetWorkspaceSyncState]);

	useEffect(() => {
		if (!isProjectSwitching) {
			return;
		}
		resetTaskEditorState();
	}, [isProjectSwitching, resetTaskEditorState]);

	const {
		runningGitAction,
		taskGitActionLoadingByTaskId,
		commitTaskLoadingById,
		openPrTaskLoadingById,
		agentCommitTaskLoadingById,
		agentOpenPrTaskLoadingById,
		isDiscardingHomeWorkingChanges,
		gitActionError,
		gitActionErrorTitle,
		clearGitActionError,
		gitHistory,
		runGitAction,
		switchHomeBranch,
		discardHomeWorkingChanges,
		handleCommitTask,
		handleOpenPrTask,
		handleAgentCommitTask,
		handleAgentOpenPrTask,
		runAutoReviewGitAction,
		resetGitActionState,
	} = useGitActions({
		currentProjectId,
		board,
		selectedCard,
		runtimeProjectConfig,
		sendTaskSessionInput,
		sendTaskChatMessage,
		isGitHistoryOpen,
		refreshWorkspaceState,
	});
	const agentCommand = runtimeProjectConfig?.effectiveCommand ?? null;
	const {
		homeTerminalTaskId,
		isHomeTerminalOpen,
		isHomeTerminalStarting,
		homeTerminalPaneHeight,
		isDetailTerminalOpen,
		detailTerminalTaskId,
		isDetailTerminalStarting,
		detailTerminalPaneHeight,
		isHomeTerminalExpanded,
		isDetailTerminalExpanded,
		setHomeTerminalPaneHeight,
		setDetailTerminalPaneHeight,
		handleToggleExpandHomeTerminal,
		handleToggleExpandDetailTerminal,
		handleToggleHomeTerminal,
		handleToggleDetailTerminal,
		handleSendAgentCommandToHomeTerminal,
		handleSendAgentCommandToDetailTerminal,
		prepareTerminalForShortcut,
		resetBottomTerminalLayoutCustomizations,
		collapseHomeTerminal,
		collapseDetailTerminal,
		closeHomeTerminal,
		closeDetailTerminal,
		resetTerminalPanelsState,
	} = useTerminalPanels({
		currentProjectId,
		selectedCard,
		workspaceGit,
		agentCommand,
		upsertSession,
		sendTaskSessionInput,
	});
	const homeTerminalSummary = sessions[homeTerminalTaskId] ?? null;
	const { runningShortcutLabel, handleSelectShortcutLabel, handleRunShortcut, handleCreateShortcut } =
		useShortcutActions({
			currentProjectId,
			selectedShortcutLabel: runtimeProjectConfig?.selectedShortcutLabel,
			shortcuts,
			refreshRuntimeProjectConfig,
			prepareTerminalForShortcut,
			prepareWaitForTerminalConnectionReady,
			sendTaskSessionInput,
		});

	const persistWorkspaceStateAsync = useCallback(
		async (input: { workspaceId: string; payload: Parameters<typeof saveWorkspaceState>[1] }) =>
			await saveWorkspaceState(input.workspaceId, input.payload),
		[],
	);
	const [workspaceConflictNoticeVisible, setWorkspaceConflictNoticeVisible] = useState(false);
	const [pendingWorkspaceConflictBoard, setPendingWorkspaceConflictBoard] = useState<BoardData | null>(null);
	const handleWorkspaceStateConflict = useCallback(
		(input: {
			workspaceId: string;
			currentRevision: number;
			localBoard: BoardData;
			recoveredBoard: BoardData | null;
		}) => {
			setPendingWorkspaceConflictBoard(input.localBoard);
			setWorkspaceConflictNoticeVisible(true);
		},
		[],
	);

	const handleWorkspaceRevisionChange = useCallback((revision: number) => {
		setWorkspaceRevision(revision);
		// A clean sync after a conflict means the boards converged — the stale warning would only invite a
		// destructive "restore" of agent-made progress (live-found 2026-07-10 on a simulated busy board).
		setWorkspaceConflictNoticeVisible((visible) => (visible ? false : visible));
	}, []);
	useWorkspacePersistence({
		board,
		currentProjectId,
		workspaceRevision,
		hydrationNonce: workspaceHydrationNonce,
		canPersistWorkspaceState,
		isDocumentVisible,
		isWorkspaceStateRefreshing,
		persistWorkspaceState: persistWorkspaceStateAsync,
		refetchWorkspaceState: refreshWorkspaceState,
		onWorkspaceRevisionChange: handleWorkspaceRevisionChange,
		onBoardRebased: setBoard,
		onWorkspaceStateConflict: handleWorkspaceStateConflict,
	});

	useEffect(() => {
		setWorkspaceConflictNoticeVisible(false);
		setPendingWorkspaceConflictBoard(null);
	}, [currentProjectId]);

	useEffect(() => {
		if (!streamError) {
			lastStreamErrorRef.current = null;
			return;
		}
		const removedPath = parseRemovedProjectPathFromStreamError(streamError);
		if (removedPath !== null) {
			showAppToast(
				{
					intent: "danger",
					icon: "warning-sign",
					message: removedPath
						? `Project no longer exists and was removed: ${removedPath}`
						: "Project no longer exists and was removed.",
					timeout: 6000,
				},
				`project-removed-${removedPath || "unknown"}`,
			);
			lastStreamErrorRef.current = null;
			return;
		}
		if (isRuntimeDisconnected) {
			lastStreamErrorRef.current = streamError;
			return;
		}
		if (lastStreamErrorRef.current !== streamError) {
			notifyError(streamError, { key: `error:${streamError}` });
		}
		lastStreamErrorRef.current = streamError;
	}, [isRuntimeDisconnected, streamError]);

	useEffect(() => {
		resetTaskEditorState();
		setIsClearTrashDialogOpen(false);
		resetGitActionState();
		resetProjectNavigationState();
		resetTerminalPanelsState();
	}, [
		currentProjectId,
		resetGitActionState,
		resetProjectNavigationState,
		resetTaskEditorState,
		resetTerminalPanelsState,
	]);

	useEffect(() => {
		if (selectedCard) {
			return;
		}
		if (hasNoProjects || !currentProjectId) {
			if (isHomeTerminalOpen) {
				closeHomeTerminal();
			}
			return;
		}
	}, [closeHomeTerminal, currentProjectId, hasNoProjects, isHomeTerminalOpen, selectedCard]);
	const showHomeBottomTerminal = !selectedCard && !hasNoProjects && isHomeTerminalOpen;
	const homeTerminalSubtitle = useMemo(
		() => workspacePath ?? navigationProjectPath ?? null,
		[navigationProjectPath, workspacePath],
	);

	const handleOpenSettings = useCallback((section?: RuntimeSettingsSection) => {
		setSettingsInitialSection(section ?? null);
		setIsSettingsOpen(true);
	}, []);
	const handleToggleGitHistory = useCallback(() => {
		if (hasNoProjects) {
			return;
		}
		setIsGitHistoryOpen((current) => !current);
	}, [hasNoProjects]);
	const handleCloseGitHistory = useCallback(() => {
		setIsGitHistoryOpen(false);
	}, []);

	const {
		handleProgrammaticCardMoveReady,
		handleCreateDependency,
		handleDeleteDependency,
		handleDragEnd,
		handleStartTask,
		handleStartAllBacklogTasks,
		handleDecomposeTask,
		handleReplayTask,
		handleDetailTaskDragEnd,
		handleCardSelect,
		handleMoveToTrash,
		handleMoveReviewCardToTrash,
		handleRestoreTaskFromTrash,
		handleCancelAutomaticTaskAction,
		handleOpenClearTrash,
		handleConfirmClearTrash,
		handleAddReviewComments,
		handleSendReviewComments,
		moveToTrashLoadingById,
		replayTaskLoadingById,
		trashTaskCount,
	} = useBoardInteractions({
		board,
		setBoard,
		sessions,
		setSessions,
		selectedCard,
		selectedTaskId,
		currentProjectId,
		setSelectedTaskId,
		setIsClearTrashDialogOpen,
		setIsGitHistoryOpen,
		stopTaskSession,
		cleanupTaskArtifacts,
		startTaskSession,
		sendTaskSessionInput,
		activeTaskSessionCount,
		maxConcurrentTasks: runtimeProjectConfig?.maxConcurrentTasks ?? 3,
		readyForReviewNotificationsEnabled,
		taskGitActionLoadingByTaskId,
		runAutoReviewGitAction,
	});

	const {
		handleCreateAndStartTask,
		handleCreateAndStartTasks,
		handleCreateStartAndOpenTask,
		handleStartTaskFromBoard,
		handleStartAllBacklogTasksFromBoard,
	} = useTaskStartActions({
		board,
		handleCreateTask,
		handleCreateTasks,
		handleStartTask,
		handleStartAllBacklogTasks,
		setSelectedTaskId,
	});

	const handleOpenCommandPalette = useCallback(() => {
		setIsCommandPaletteOpen(true);
	}, []);

	useAppHotkeys({
		selectedCard,
		isDetailTerminalOpen,
		isHomeTerminalOpen: showHomeBottomTerminal,
		isHomeGitHistoryOpen: !selectedCard && isGitHistoryOpen,
		canUseCreateTaskShortcut: !hasNoProjects && currentProjectId !== null,
		handleToggleDetailTerminal,
		handleToggleHomeTerminal,
		handleToggleExpandDetailTerminal,
		handleToggleExpandHomeTerminal: handleToggleExpandHomeTerminal,
		handleOpenCreateTask,
		handleOpenSettings,
		handleOpenCommandPalette,
		handleToggleGitHistory,
		handleCloseGitHistory,
		onStartAllTasks: handleStartAllBacklogTasksFromBoard,
	});

	useEffect(() => {
		if (!pendingTaskStartAfterEditId) {
			return;
		}
		const selection = findCardSelection(board, pendingTaskStartAfterEditId);
		if (selection?.column.id !== "backlog") {
			return;
		}
		handleStartTaskFromBoard(pendingTaskStartAfterEditId);
		setPendingTaskStartAfterEditId(null);
	}, [board, handleStartTaskFromBoard, pendingTaskStartAfterEditId]);

	const detailSession = selectedCard
		? (sessions[selectedCard.card.id] ?? createIdleTaskSession(selectedCard.card.id))
		: null;
	const detailTerminalSummary = detailTerminalTaskId ? (sessions[detailTerminalTaskId] ?? null) : null;
	const detailTerminalSubtitle = useMemo(() => {
		if (!selectedCard) {
			return null;
		}
		return getTaskWorkspaceSnapshot(selectedCard.card.id)?.path ?? null;
	}, [selectedCard]);

	const runtimeHint = useMemo(() => {
		return getTaskAgentNavbarHint(runtimeProjectConfig, {
			shouldUseNavigationPath,
		});
	}, [runtimeProjectConfig, shouldUseNavigationPath]);

	const activeWorkspacePath = selectedCard
		? (getTaskWorkspaceSnapshot(selectedCard.card.id)?.path ?? workspacePath ?? undefined)
		: shouldUseNavigationPath
			? (navigationProjectPath ?? undefined)
			: (workspacePath ?? undefined);
	// Native NKlein tasks have no host workspace to report a "not prepared / cleaned up" hint for (worktrees
	// retired, §5.A); the navbar workspace hint is no longer applicable.
	const activeWorkspaceHint = undefined;

	const sidebarLayout = useProjectNavigationLayout();
	const handleToggleSidebar = useCallback(() => {
		sidebarLayout.setSidebarCollapsed(!sidebarLayout.isCollapsed);
	}, [sidebarLayout]);

	const navbarWorkspacePath = hasNoProjects ? undefined : activeWorkspacePath;
	const navbarWorkspaceHint = hasNoProjects ? undefined : activeWorkspaceHint;
	const navbarRuntimeHint = hasNoProjects ? undefined : runtimeHint;
	const shouldHideProjectDependentTopBarActions =
		!selectedCard && (isProjectSwitching || isAwaitingWorkspaceSnapshot || isWorkspaceMetadataPending);

	const {
		openTargetOptions,
		selectedOpenTargetId,
		onSelectOpenTarget,
		onOpenWorkspace,
		canOpenWorkspace,
		isOpeningWorkspace,
	} = useOpenWorkspace({
		currentProjectId,
		workspacePath: activeWorkspacePath,
	});
	const selectedTaskChatMessages = selectTaskChatMessagesForTask(selectedCard?.card.id, taskChatMessagesByTaskId);
	// §5.V: live reasoning-phase snippets for board cards — derived once here so the board re-renders on a tiny
	// snippet map, never on the raw task-chat message firehose.
	const reasoningSnippetByTaskId = useMemo(
		() => deriveReasoningSnippetByTask(taskChatMessagesByTaskId),
		[taskChatMessagesByTaskId],
	);
	const selectedTaskTeamProgress = selectedCard ? (nkleinTeamProgressByTaskId[selectedCard.card.id] ?? []) : [];
	const latestSelectedTaskChatMessage = selectLatestTaskChatMessageForTask(
		selectedCard?.card.id,
		latestTaskChatMessage,
	);
	const defaultTaskNKleinProviderId =
		runtimeProjectConfig?.nkleinProviderSettings?.providerId ??
		runtimeProjectConfig?.nkleinProviderSettings?.oauthProvider ??
		null;
	const handleNKleinTaskSettingsChangedForTask = useCallback(
		({
			providerId,
			modelId,
			reasoningEffort,
			contextScope,
			timeoutMode,
		}: {
			providerId: string;
			modelId: string;
			reasoningEffort: RuntimeNKleinReasoningEffort | "";
			contextScope: "full" | "smart" | "minimal" | "custom";
			timeoutMode: "normal" | "long" | "extended" | "unlimited";
		}) => {
			if (!selectedCard) {
				return;
			}
			const taskId = selectedCard.card.id;
			setBoard((currentBoard) => {
				const result = applyTaskDetailNKleinSettingsChange(
					currentBoard,
					taskId,
					{
						providerId,
						modelId,
						reasoningEffort,
						contextScope,
						timeoutMode,
					},
					{
						providerId: defaultTaskNKleinProviderId,
						modelId: runtimeProjectConfig?.nkleinProviderSettings?.modelId ?? null,
					},
				);
				return result.updated ? result.board : currentBoard;
			});
		},
		[defaultTaskNKleinProviderId, runtimeProjectConfig, selectedCard, setBoard],
	);

	const handleApprovePlanningCard = useCallback(
		(taskId: string) => {
			setBoard((currentBoard) => {
				const result = approvePlanningTaskForExecution(currentBoard, taskId);
				return result.updated ? result.board : currentBoard;
			});
			// Approving for execution must actually launch the task when nothing is running
			// yet, instead of leaving it parked in planning as "Execution approved". If a
			// session is already active, leave it running rather than restarting it.
			if (!sessions[taskId]) {
				handleStartTask(taskId);
			}
		},
		[handleStartTask, sessions, setBoard],
	);

	const handleCreateDialogOpenChange = useCallback(
		(open: boolean) => {
			if (!open) {
				handleCancelCreateTask();
			}
		},
		[handleCancelCreateTask],
	);

	const inlineTaskEditor = editingTaskId ? (
		<TaskInlineCreateCard
			prompt={editTaskPrompt}
			onPromptChange={setEditTaskPrompt}
			images={editTaskImages}
			onImagesChange={setEditTaskImages}
			onCreate={handleSaveEditedTask}
			onCreateAndStart={handleSaveAndStartEditedTask}
			onCancel={handleCancelEditTask}
			startInPlanMode={editTaskStartInPlanMode}
			onStartInPlanModeChange={setEditTaskStartInPlanMode}
			startInPlanModeDisabled={isEditTaskStartInPlanModeDisabled}
			autoReviewEnabled={editTaskAutoReviewEnabled}
			onAutoReviewEnabledChange={setEditTaskAutoReviewEnabled}
			autoReviewMode={editTaskAutoReviewMode}
			onAutoReviewModeChange={setEditTaskAutoReviewMode}
			workspaceId={currentProjectId}
			branchRef={editTaskBranchRef}
			branchOptions={createTaskBranchOptions}
			onBranchRefChange={setEditTaskBranchRef}
			agentId={editTaskAgentId}
			onAgentIdChange={setEditTaskAgentId}
			nkleinSettings={editTaskNKleinSettings}
			onNKleinSettingsChange={setEditTaskNKleinSettings}
			defaultAgentId={runtimeProjectConfig?.selectedAgentId ?? null}
			defaultProviderId={defaultTaskNKleinProviderId}
			defaultModelId={runtimeProjectConfig?.nkleinProviderSettings?.modelId ?? null}
			defaultReasoningEffort={runtimeProjectConfig?.nkleinProviderSettings?.reasoningEffort ?? null}
			cloudProviderSupportEnabled={cloudProviderSupportEnabled}
			mode="edit"
			idPrefix={`inline-edit-task-${editingTaskId}`}
		/>
	) : undefined;

	if (isRuntimeDisconnected) {
		return <RuntimeDisconnectedFallback />;
	}
	if (isKanbanAccessBlocked) {
		return <KanbanAccessBlockedFallback />;
	}

	const manageDependenciesCard = manageDependenciesCardId
		? (board.columns.flatMap((col) => col.cards).find((c) => c.id === manageDependenciesCardId) ?? null)
		: null;
	const manageDependenciesAllCards: DependencyPickerCard[] = manageDependenciesCardId
		? board.columns
				.filter((col) => col.id !== "trash")
				.flatMap((col) => col.cards.map((c) => ({ id: c.id, title: c.title, columnTitle: col.title })))
		: [];

	return (
		<LayoutCustomizationsProvider onResetBottomTerminalLayoutCustomizations={resetBottomTerminalLayoutCustomizations}>
			<div className="kb-app-root flex h-[100svh] min-w-0 overflow-hidden">
				{!selectedCard ? (
					<ProjectNavigationPanel
						projects={displayedProjects}
						isLoadingProjects={isProjectListLoading}
						currentProjectId={navigationCurrentProjectId}
						removingProjectId={removingProjectId}
						selectedAgentId={settingsRuntimeProjectConfig?.selectedAgentId ?? null}
						nkleinProviderSettings={settingsRuntimeProjectConfig?.nkleinProviderSettings ?? null}
						cloudProviderSupportEnabled={cloudProviderSupportEnabled}
						developerModeEnabled={developerModeEnabled}
						featurebaseFeedbackState={featurebaseFeedbackState}
						onSelectProject={(projectId) => {
							void handleSelectProject(projectId);
						}}
						onRemoveProject={handleRemoveProject}
						onAddProject={() => {
							void handleAddProject();
						}}
						sidebarWidth={sidebarLayout.sidebarWidth}
						setExpandedSidebarWidth={sidebarLayout.setExpandedSidebarWidth}
						isCollapsed={sidebarLayout.isCollapsed}
						setSidebarCollapsed={sidebarLayout.setSidebarCollapsed}
					/>
				) : null}
				<div className="flex flex-col flex-1 min-w-0 overflow-hidden">
					{/* informational dev surface -> developer mode only (works in packaged builds) */}
					<TopBar
						onToggleSidebar={!selectedCard ? handleToggleSidebar : undefined}
						onBack={selectedCard ? handleBack : undefined}
						workspacePath={navbarWorkspacePath}
						isWorkspacePathLoading={shouldShowProjectLoadingState}
						workspaceHint={navbarWorkspaceHint}
						runtimeHint={navbarRuntimeHint}
						selectedTaskId={selectedCard?.card.id ?? null}
						showHomeGitSummary={!hasNoProjects && !selectedCard}
						runningGitAction={selectedCard || hasNoProjects ? null : runningGitAction}
						onGitFetch={
							selectedCard
								? undefined
								: () => {
										void runGitAction("fetch");
									}
						}
						onGitPull={
							selectedCard
								? undefined
								: () => {
										void runGitAction("pull");
									}
						}
						onGitPush={
							selectedCard
								? undefined
								: () => {
										void runGitAction("push");
									}
						}
						onToggleTerminal={
							hasNoProjects ? undefined : selectedCard ? handleToggleDetailTerminal : handleToggleHomeTerminal
						}
						isTerminalOpen={selectedCard ? isDetailTerminalOpen : showHomeBottomTerminal}
						isTerminalLoading={selectedCard ? isDetailTerminalStarting : isHomeTerminalStarting}
						onOpenSettings={handleOpenSettings}
						showDebugButton={developerModeEnabled}
						onOpenDebugDialog={developerModeEnabled ? handleOpenDebugDialog : undefined}
						shortcuts={shortcuts}
						selectedShortcutLabel={selectedShortcutLabel}
						onSelectShortcutLabel={handleSelectShortcutLabel}
						runningShortcutLabel={runningShortcutLabel}
						onRunShortcut={handleRunShortcut}
						onCreateFirstShortcut={currentProjectId ? handleCreateShortcut : undefined}
						openTargetOptions={openTargetOptions}
						selectedOpenTargetId={selectedOpenTargetId}
						onSelectOpenTarget={onSelectOpenTarget}
						onOpenWorkspace={onOpenWorkspace}
						canOpenWorkspace={canOpenWorkspace}
						isOpeningWorkspace={isOpeningWorkspace}
						onToggleGitHistory={hasNoProjects ? undefined : handleToggleGitHistory}
						isGitHistoryOpen={isGitHistoryOpen}
						hideProjectDependentActions={shouldHideProjectDependentTopBarActions}
					/>
					<div className="relative flex flex-1 min-h-0 min-w-0 overflow-hidden">
						<div
							className="kb-home-layout"
							aria-hidden={selectedCard ? true : undefined}
							style={selectedCard ? { visibility: "hidden" } : undefined}
						>
							{shouldShowProjectLoadingState ? (
								<div className="flex flex-1 min-h-0 items-center justify-center bg-surface-0">
									<Spinner size={30} />
								</div>
							) : hasNoProjects ? (
								<div className="flex flex-1 min-h-0 items-center justify-center bg-surface-0 p-6">
									<div className="flex flex-col items-center justify-center gap-3 text-text-tertiary">
										<FolderOpen size={48} strokeWidth={1} />
										<h3 className="text-sm font-semibold text-text-primary">No projects yet</h3>
										<p className="max-w-sm text-center text-[13px] text-text-secondary">
											Add a git repository, or check local model setup before starting your first task.
										</p>
										<div className="flex flex-wrap items-center justify-center gap-2">
											<Button
												variant="primary"
												onClick={() => {
													void handleAddProject();
												}}
											>
												Add Project
											</Button>
											<Button variant="ghost" onClick={handleShowStartupOnboardingDialog}>
												Local model setup
											</Button>
										</div>
									</div>
								</div>
							) : (
								<div className="flex flex-1 flex-col min-h-0 min-w-0">
									{workspaceConflictNoticeVisible ? (
										<WorkspaceConflictNotice
											onDismiss={() => {
												setWorkspaceConflictNoticeVisible(false);
												setPendingWorkspaceConflictBoard(null);
											}}
											onRefresh={() => {
												setWorkspaceConflictNoticeVisible(false);
												setPendingWorkspaceConflictBoard(null);
												void refreshWorkspaceState();
											}}
											onRestoreLocalEdit={
												pendingWorkspaceConflictBoard
													? () => {
															setBoard(pendingWorkspaceConflictBoard);
															setWorkspaceConflictNoticeVisible(false);
															setPendingWorkspaceConflictBoard(null);
														}
													: undefined
											}
										/>
									) : null}
									{/* §5.BB zoom control — one continuous surface, four zoom levels (buttons per the user's pick). */}
									{!isGitHistoryOpen ? (
										<div className="flex shrink-0 items-center gap-2 border-b border-border bg-surface-1 px-3 py-1.5">
											<div className="inline-flex overflow-hidden rounded-lg border border-border-bright bg-surface-2">
												{ZOOM_LEVELS.map((entry) => (
													<button
														key={entry.level}
														type="button"
														onClick={() => setZoom(entry.level)}
														className={
															zoom === entry.level
																? "flex items-center gap-1.5 border-r border-border bg-accent/15 px-3 py-1 text-[12px] text-accent last:border-r-0"
																: "flex items-center gap-1.5 border-r border-border px-3 py-1 text-[12px] text-text-tertiary hover:text-text-primary last:border-r-0"
														}
													>
														<span className="rounded border border-current px-1 text-[9px] opacity-70">
															{entry.short}
														</span>
														{entry.label}
													</button>
												))}
											</div>
											<button
												type="button"
												data-testid="open-dag-view"
												title="Open the full dependency graph (pan/zoom, cycles marked)"
												onClick={() => setIsDagViewOpen(true)}
												className="inline-flex items-center gap-1 rounded-lg border border-border-bright bg-surface-2 px-2.5 py-1 text-[12px] text-text-tertiary hover:text-text-primary"
											>
												<GitFork size={13} />
												DAG
											</button>
											{needsYouCount > 0 ? (
												// W3.4: the needs-you badge — visible at every zoom; click = jump to the full board.
												<button
													type="button"
													data-testid="needs-you-badge"
													title={`${needsYouCount} card${needsYouCount === 1 ? "" : "s"} need${needsYouCount === 1 ? "s" : ""} your input — open the full board`}
													onClick={() => setZoom(3)}
													className="inline-flex items-center gap-1.5 rounded-full border border-status-gold/40 bg-status-gold/10 px-2.5 py-0.5 text-[11.5px] text-status-gold hover:bg-status-gold/20"
												>
													<span aria-hidden>●</span>
													{needsYouCount} need{needsYouCount === 1 ? "s" : ""} you
												</button>
											) : null}
											{zoom === 0 ? (
												<span className="text-[11px] text-text-tertiary">
													just talk to !Klein — zoom in anytime for the board behind it
												</span>
											) : zoom === 1 ? (
												<span className="text-[11px] text-text-tertiary">
													click a cluster to zoom in · chat on the right steers the swarm
												</span>
											) : null}
										</div>
									) : null}
									<div className="flex flex-1 min-h-0 min-w-0">
										{isGitHistoryOpen ? (
											<GitHistoryView
												workspaceId={currentProjectId}
												gitHistory={gitHistory}
												onCheckoutBranch={(branch) => {
													void switchHomeBranch(branch);
												}}
												onDiscardWorkingChanges={() => {
													void discardHomeWorkingChanges();
												}}
												isDiscardWorkingChangesPending={isDiscardingHomeWorkingChanges}
											/>
										) : zoom === 0 ? (
											<ChatPrimaryPane
												boardCards={chatBoardCards}
												boardStreams={chatBoardStreams}
												onOpenCard={handleCardSelect}
												activityTicks={activityTicks}
											/>
										) : zoom === 1 ? (
											<ActivityMapView
												map={composeActivityMap({
													columns: board.columns,
													dependencies: board.dependencies,
													sessions,
													now: Date.now,
												})}
												onSelectCard={handleCardSelect}
												onZoomToStream={zoomToStream}
												highlightCardId={chatHoverCardId}
											/>
										) : zoom === 2 ? (
											<LeanBoardView
												columns={board.columns}
												sessions={sessions}
												dependencies={board.dependencies ?? []}
												streamFilter={streamFilter}
												onSelectCard={handleCardSelect}
												onBackToOverview={() => setZoom(1)}
											/>
										) : (
											<KanbanBoard
												professionalDefaults={zoom === 4}
												data={board}
												taskSessions={sessions}
												reasoningSnippetByTaskId={reasoningSnippetByTaskId}
												workspacePath={workspacePath}
												currentProjectId={currentProjectId}
												runtimeConfig={runtimeProjectConfig ?? null}
												onRuntimeConfigChanged={() => {
													refreshRuntimeProjectConfig();
													refreshSettingsRuntimeProjectConfig();
												}}
												onTaskSessionSummary={upsertSession}
												replayCardsEnabled={runtimeProjectConfig?.replayCardsEnabled ?? false}
												onCardSelect={handleCardSelect}
												onCreateTask={handleOpenCreateTask}
												onStartTask={handleStartTaskFromBoard}
												onDecomposeTask={handleDecomposeTask}
												onReplayTask={handleReplayTask}
												onStartAllTasks={handleStartAllBacklogTasksFromBoard}
												onClearTrash={handleOpenClearTrash}
												editingTaskId={editingTaskId}
												inlineTaskEditor={inlineTaskEditor}
												onEditTask={handleOpenEditTask}
												onSaveTaskTitle={handleSaveTaskTitle}
												onCommitTask={handleCommitTask}
												onOpenPrTask={handleOpenPrTask}
												onCancelAutomaticTaskAction={handleCancelAutomaticTaskAction}
												commitTaskLoadingById={commitTaskLoadingById}
												openPrTaskLoadingById={openPrTaskLoadingById}
												moveToTrashLoadingById={moveToTrashLoadingById}
												replayTaskLoadingById={replayTaskLoadingById}
												onMoveToTrashTask={handleMoveReviewCardToTrash}
												onRestoreFromTrashTask={handleRestoreTaskFromTrash}
												dependencies={board.dependencies}
												onCreateDependency={handleCreateDependency}
												onDeleteDependency={handleDeleteDependency}
												onManageDependencies={setManageDependenciesCardId}
												onRequestProgrammaticCardMoveReady={
													selectedCard ? undefined : handleProgrammaticCardMoveReady
												}
												onDragEnd={handleDragEnd}
												defaultAgentId={runtimeProjectConfig?.selectedAgentId ?? null}
											/>
										)}
									</div>
									{showHomeBottomTerminal ? (
										<ResizableBottomPane
											minHeight={200}
											initialHeight={homeTerminalPaneHeight}
											onHeightChange={setHomeTerminalPaneHeight}
											onCollapse={collapseHomeTerminal}
											isExpanded={isHomeTerminalExpanded}
										>
											<div
												style={{
													display: "flex",
													flex: "1 1 0",
													minWidth: 0,
													paddingLeft: 12,
													paddingRight: 12,
												}}
											>
												<AgentTerminalPanel
													key={`home-shell-${homeTerminalTaskId}`}
													taskId={homeTerminalTaskId}
													workspaceId={currentProjectId}
													summary={homeTerminalSummary}
													onSummary={upsertSession}
													showSessionToolbar={false}
													autoFocus
													onClose={closeHomeTerminal}
													minimalHeaderTitle="Terminal"
													minimalHeaderSubtitle={homeTerminalSubtitle}
													panelBackgroundColor="var(--color-surface-1)"
													terminalBackgroundColor={terminalThemeColors.surfaceRaised}
													cursorColor={terminalThemeColors.textPrimary}
													onConnectionReady={markTerminalConnectionReady}
													agentCommand={agentCommand}
													onSendAgentCommand={handleSendAgentCommandToHomeTerminal}
													isExpanded={isHomeTerminalExpanded}
													onToggleExpand={handleToggleExpandHomeTerminal}
												/>
											</div>
										</ResizableBottomPane>
									) : null}
								</div>
							)}
						</div>
						{selectedCard && detailSession ? (
							<div className="absolute inset-0 flex min-h-0 min-w-0">
								<CardDetailView
									selection={selectedCard}
									dependencies={board.dependencies}
									currentProjectId={currentProjectId}
									workspacePath={workspacePath}
									selectedAgentId={runtimeProjectConfig?.selectedAgentId ?? null}
									runtimeConfig={runtimeProjectConfig ?? null}
									sessionSummary={detailSession}
									taskSessions={sessions}
									onSessionSummary={upsertSession}
									onCardSelect={handleCardSelect}
									onTaskDragEnd={handleDetailTaskDragEnd}
									onCreateTask={handleOpenCreateTask}
									onStartTask={handleStartTaskFromBoard}
									onStartAllTasks={handleStartAllBacklogTasksFromBoard}
									onClearTrash={handleOpenClearTrash}
									editingTaskId={editingTaskId}
									inlineTaskEditor={inlineTaskEditor}
									onEditTask={(task) => {
										handleOpenEditTask(task, { preserveDetailSelection: true });
									}}
									onSaveTaskTitle={handleSaveTaskTitle}
									onUpdateFocusChain={handleUpdateTaskFocusChain}
									onCommitTask={handleCommitTask}
									onOpenPrTask={handleOpenPrTask}
									onAgentCommitTask={handleAgentCommitTask}
									onAgentOpenPrTask={handleAgentOpenPrTask}
									commitTaskLoadingById={commitTaskLoadingById}
									openPrTaskLoadingById={openPrTaskLoadingById}
									agentCommitTaskLoadingById={agentCommitTaskLoadingById}
									agentOpenPrTaskLoadingById={agentOpenPrTaskLoadingById}
									moveToTrashLoadingById={moveToTrashLoadingById}
									onMoveReviewCardToTrash={handleMoveReviewCardToTrash}
									onRestoreTaskFromTrash={handleRestoreTaskFromTrash}
									onCancelAutomaticTaskAction={handleCancelAutomaticTaskAction}
									onAddReviewComments={(taskId: string, text: string) => {
										void handleAddReviewComments(taskId, text);
									}}
									onSendReviewComments={(taskId: string, text: string) => {
										void handleSendReviewComments(taskId, text);
									}}
									onSendNKleinChatMessage={sendTaskChatMessage}
									onCancelNKleinChatTurn={cancelTaskChatTurn}
									onGrantProtectedTestApproval={grantProtectedTestApproval}
									onMarkTaskInterrupted={markTaskInterrupted}
									onLoadNKleinChatMessages={fetchTaskChatMessages}
									latestNKleinChatMessage={latestSelectedTaskChatMessage}
									streamedNKleinChatMessages={selectedTaskChatMessages}
									nkleinTeamProgress={selectedTaskTeamProgress}
									onMoveToTrash={handleMoveToTrash}
									isMoveToTrashLoading={moveToTrashLoadingById[selectedCard.card.id] ?? false}
									gitHistoryPanel={
										isGitHistoryOpen ? (
											<GitHistoryView workspaceId={currentProjectId} gitHistory={gitHistory} />
										) : undefined
									}
									onCloseGitHistory={handleCloseGitHistory}
									bottomTerminalOpen={isDetailTerminalOpen}
									bottomTerminalTaskId={detailTerminalTaskId}
									bottomTerminalSummary={detailTerminalSummary}
									bottomTerminalSubtitle={detailTerminalSubtitle}
									onBottomTerminalClose={closeDetailTerminal}
									onBottomTerminalCollapse={collapseDetailTerminal}
									bottomTerminalPaneHeight={detailTerminalPaneHeight}
									onBottomTerminalPaneHeightChange={setDetailTerminalPaneHeight}
									onBottomTerminalConnectionReady={markTerminalConnectionReady}
									bottomTerminalAgentCommand={agentCommand}
									onBottomTerminalSendAgentCommand={handleSendAgentCommandToDetailTerminal}
									isBottomTerminalExpanded={isDetailTerminalExpanded}
									onBottomTerminalToggleExpand={handleToggleExpandDetailTerminal}
									isDocumentVisible={isDocumentVisible}
									onNKleinSettingsSaved={refreshRuntimeProjectConfig}
									onTaskNKleinSettingsChanged={handleNKleinTaskSettingsChangedForTask}
									onApprovePlanningCard={handleApprovePlanningCard}
									onWorkspaceStateApplied={handleWorkspaceStateApplied}
									onManageDependencies={setManageDependenciesCardId}
								/>
							</div>
						) : null}
					</div>
				</div>
				{/* Board-independent chat as a resizeable right sidebar (todo §5.M), replacing the old modal.
				    Hidden at zoom 0 — there the chat IS the main panel (ChatPrimaryPane), never two chats at once. */}
				{zoom !== 0 ? (
					<ChatSidebar
						boardCards={chatBoardCards}
						boardStreams={chatBoardStreams}
						onOpenCard={handleCardSelect}
						onHoverCard={setChatHoverCardId}
						activityTicks={activityTicks}
					/>
				) : null}
				<RuntimeSettingsDialog
					open={isSettingsOpen}
					workspaceId={settingsWorkspaceId}
					initialConfig={settingsRuntimeProjectConfig}
					liveMcpAuthStatuses={latestMcpAuthStatuses}
					initialSection={settingsInitialSection}
					onOpenChange={(nextOpen) => {
						setIsSettingsOpen(nextOpen);
						if (!nextOpen) {
							setSettingsInitialSection(null);
						}
					}}
					onSaved={() => {
						refreshRuntimeProjectConfig();
						refreshSettingsRuntimeProjectConfig();
					}}
					onAccountSwitched={refreshKanbanAccess}
					onRunGlobalSetupWizard={() => {
						setIsSettingsOpen(false);
						globalSetupWizard.open();
					}}
					onRunProjectSetupWizard={
						settingsWorkspaceId !== null
							? () => {
									setIsSettingsOpen(false);
									projectSetupWizard.open();
								}
							: undefined
					}
				/>
				{/* informational dev surface -> developer mode only (works in packaged builds) */}
				<CommandPalette
					open={isCommandPaletteOpen}
					onOpenChange={setIsCommandPaletteOpen}
					hasProject={!hasNoProjects && currentProjectId !== null}
					showDebugCommands={developerModeEnabled}
					onCreateTask={handleOpenCreateTask}
					onAddProject={() => {
						void handleAddProject();
					}}
					onOpenSettings={handleOpenSettings}
					onOpenDebugTools={developerModeEnabled ? handleOpenDebugDialog : undefined}
					onToggleGitHistory={handleToggleGitHistory}
					onStartAllTasks={handleStartAllBacklogTasksFromBoard}
				/>
				{/* informational dev surface -> developer mode only (works in packaged builds) */}
				<DebugDialog
					open={isDebugDialogOpen}
					onOpenChange={handleDebugDialogOpenChange}
					isResetAllStatePending={isResetAllStatePending}
					dataDirectoryPath={dataDirectoryPath}
					onOpenDataDirectory={handleOpenDataDirectory}
					onShowStartupOnboardingDialog={handleShowStartupOnboardingDialog}
					onResetAllState={handleResetAllState}
				/>
				<TaskCreateDialog
					open={isInlineTaskCreateOpen}
					onOpenChange={handleCreateDialogOpenChange}
					prompt={newTaskPrompt}
					onPromptChange={setNewTaskPrompt}
					images={newTaskImages}
					onImagesChange={setNewTaskImages}
					onCreate={handleCreateTask}
					onCreateAndStart={handleCreateAndStartTask}
					onCreateStartAndOpen={handleCreateStartAndOpenTask}
					onCreateMultiple={handleCreateTasks}
					onCreateAndStartMultiple={handleCreateAndStartTasks}
					startInPlanMode={newTaskStartInPlanMode}
					onStartInPlanModeChange={setNewTaskStartInPlanMode}
					startInPlanModeDisabled={isNewTaskStartInPlanModeDisabled}
					autoReviewEnabled={newTaskAutoReviewEnabled}
					onAutoReviewEnabledChange={setNewTaskAutoReviewEnabled}
					autoReviewMode={newTaskAutoReviewMode}
					onAutoReviewModeChange={setNewTaskAutoReviewMode}
					workspaceId={currentProjectId}
					branchRef={newTaskBranchRef}
					branchOptions={createTaskBranchOptions}
					onBranchRefChange={setNewTaskBranchRef}
					agentId={newTaskAgentId}
					onAgentIdChange={setNewTaskAgentId}
					nkleinSettings={newTaskNKleinSettings}
					onNKleinSettingsChange={setNewTaskNKleinSettings}
					defaultAgentId={runtimeProjectConfig?.selectedAgentId ?? null}
					defaultProviderId={defaultTaskNKleinProviderId}
					defaultModelId={runtimeProjectConfig?.nkleinProviderSettings?.modelId ?? null}
					defaultReasoningEffort={runtimeProjectConfig?.nkleinProviderSettings?.reasoningEffort ?? null}
					cloudProviderSupportEnabled={cloudProviderSupportEnabled}
				/>
				<ClearTrashDialog
					open={isClearTrashDialogOpen}
					taskCount={trashTaskCount}
					onCancel={() => setIsClearTrashDialogOpen(false)}
					onConfirm={handleConfirmClearTrash}
				/>
				{manageDependenciesCard ? (
					<DependencyPickerDialog
						open
						onOpenChange={(open) => {
							if (!open) {
								setManageDependenciesCardId(null);
							}
						}}
						card={{ id: manageDependenciesCard.id, title: manageDependenciesCard.title }}
						allCards={manageDependenciesAllCards}
						dependencies={board.dependencies}
						onCreateDependency={handleCreateDependency}
						onDeleteDependency={handleDeleteDependency}
					/>
				) : null}
				<StartupOnboardingDialog
					open={isStartupOnboardingDialogOpen}
					onClose={handleCloseStartupOnboardingDialog}
					selectedAgentId={runtimeProjectConfig?.selectedAgentId ?? null}
					agents={runtimeProjectConfig?.agents ?? []}
					nkleinProviderSettings={runtimeProjectConfig?.nkleinProviderSettings ?? null}
					workspaceId={currentProjectId}
					runtimeConfig={runtimeProjectConfig ?? null}
					onSelectAgent={handleSelectOnboardingAgent}
					onNKleinSetupSaved={handleOnboardingNKleinSetupSaved}
				/>

				{/* W3.4: the dedicated dependency-graph view (any zoom). */}
				<BoardDagView
					open={isDagViewOpen}
					columns={board.columns}
					dependencies={board.dependencies ?? []}
					sessions={sessions}
					onClose={() => setIsDagViewOpen(false)}
					onSelectCard={(cardId) => {
						setIsDagViewOpen(false);
						handleCardSelect(cardId);
					}}
				/>
				{/* §5.BA guided-setup wizards. Global takes precedence; project is suppressed while global is open. */}
				<SetupWizardDialog
					open={globalSetupWizard.isOpen}
					kind="global"
					steps={globalSetupWizard.steps}
					isSaving={globalSetupWizard.isSaving}
					completedAt={globalSetupWizard.completedAt}
					onComplete={() => void globalSetupWizard.complete()}
					onSkip={globalSetupWizard.skip}
					// §5.BB zoom onboarding: "How much do you want to see?" — picks the starting zoom level live.
					zoomChooser={{ zoom, onPick: setZoom }}
				/>
				<SetupWizardDialog
					open={projectSetupWizard.isOpen}
					kind="project"
					steps={projectSetupWizard.steps}
					isSaving={projectSetupWizard.isSaving}
					completedAt={projectSetupWizard.completedAt}
					onComplete={() => void projectSetupWizard.complete()}
					onSkip={projectSetupWizard.skip}
				/>

				<AddProjectDialog
					open={isAddProjectDialogOpen}
					onOpenChange={setIsAddProjectDialogOpen}
					onProjectAdded={handleAddProjectSuccess}
					currentProjectId={currentProjectId}
					initialGitInitPath={pendingNativeGitInitPath}
					initialSelfProjectPath={pendingNativeSelfProjectPath}
				/>

				<UpdateNotificationController />

				<AlertDialog
					open={gitActionError !== null}
					onOpenChange={(open) => {
						if (!open) {
							clearGitActionError();
						}
					}}
				>
					<AlertDialogHeader>
						<AlertDialogTitle>{gitActionErrorTitle}</AlertDialogTitle>
					</AlertDialogHeader>
					<AlertDialogBody>
						<p>{gitActionError?.message}</p>
						{gitActionError?.output ? (
							<pre className="max-h-[220px] overflow-auto rounded-md bg-surface-0 p-3 font-mono text-xs text-text-secondary whitespace-pre-wrap">
								{gitActionError.output}
							</pre>
						) : null}
					</AlertDialogBody>
					<AlertDialogFooter className="justify-end">
						<AlertDialogAction asChild>
							<Button variant="default" onClick={clearGitActionError}>
								Close
							</Button>
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialog>
			</div>
		</LayoutCustomizationsProvider>
	);
}

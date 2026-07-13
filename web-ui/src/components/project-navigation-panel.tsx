import { Plus } from "lucide-react";
import { type MouseEvent as ReactMouseEvent, useCallback, useEffect, useRef, useState } from "react";
import { showAppToast } from "@/components/app-toaster";
import { CodeIntelligencePanel } from "@/components/code-intelligence-panel";
import { canShowFeaturebaseFeedbackButton } from "@/components/featurebase-feedback-button";
import { DevTestProjectCard } from "@/components/project-nav/dev-test-project-card";
import { ProjectHealthCard } from "@/components/project-nav/project-health-card";
import { ProjectRow, ProjectRowSkeleton } from "@/components/project-nav/project-row";
import { ProjectSupportFooter } from "@/components/project-nav/project-support-footer";
import { ShortcutsCard } from "@/components/project-nav/shortcuts-card";
import { ProjectSettingsDialog } from "@/components/project-settings-dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogBody,
	AlertDialogCancel,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/dialog";
import { ElementTooltip } from "@/components/ui/element-tooltip";
import { NKleinMark } from "@/components/ui/nklein-mark";
import { Spinner } from "@/components/ui/spinner";
import type { FeaturebaseFeedbackState } from "@/hooks/use-featurebase-feedback-widget";
import { useIsMobile } from "@/hooks/use-is-mobile";
import {
	cleanupDevTestProjects,
	createDevTestProject,
	createSelfImprovementProject,
	listDevTestProjects,
	migrateAccidentalProjectArtifacts,
} from "@/runtime/runtime-config-query";
import { getRuntimeTrpcClient } from "@/runtime/trpc-client";
import type {
	RuntimeAgentId,
	RuntimeDevTestRegistryEntry,
	RuntimeNKleinProviderSettings,
	RuntimeProjectSummary,
} from "@/runtime/types";
import { fetchWorkspaceState, saveWorkspaceState } from "@/runtime/workspace-state-query";
import { moveTaskToColumn } from "@/state/board-state";
import { useUnmount, useWindowEvent } from "@/utils/react-use";

const COLLAPSED_WIDTH = 48;
const SIDEBAR_COLLAPSE_THRESHOLD = 120;
const SIDEBAR_MIN_EXPANDED_WIDTH = 200;
const SIDEBAR_MAX_EXPANDED_WIDTH = 600;

export function ProjectNavigationPanel({
	projects,
	isLoadingProjects = false,
	currentProjectId,
	removingProjectId,
	selectedAgentId,
	nkleinProviderSettings,
	cloudProviderSupportEnabled = false,
	developerModeEnabled = false,
	featurebaseFeedbackState,
	onSelectProject,
	onRemoveProject,
	onAddProject,
	sidebarWidth,
	setExpandedSidebarWidth,
	isCollapsed,
	setSidebarCollapsed,
}: {
	projects: RuntimeProjectSummary[];
	isLoadingProjects?: boolean;
	currentProjectId: string | null;
	removingProjectId: string | null;
	selectedAgentId?: RuntimeAgentId | null;
	nkleinProviderSettings?: RuntimeNKleinProviderSettings | null;
	cloudProviderSupportEnabled?: boolean;
	developerModeEnabled?: boolean;
	featurebaseFeedbackState?: FeaturebaseFeedbackState;
	onSelectProject: (projectId: string) => void;
	onRemoveProject: (projectId: string, options?: { deleteGitRepository?: boolean }) => Promise<boolean>;
	onAddProject: () => void;
	sidebarWidth: number;
	setExpandedSidebarWidth: (width: number) => void;
	isCollapsed: boolean;
	setSidebarCollapsed: (collapsed: boolean, persist?: boolean) => void;
}): React.ReactElement {
	const sortedProjects = [...projects].sort((a, b) => a.path.localeCompare(b.path));
	const shouldShowFeaturebaseFeedback = canShowFeaturebaseFeedbackButton({
		cloudProviderSupportEnabled,
		selectedAgentId,
		nkleinProviderSettings,
		featurebaseFeedbackState,
	});

	const [pendingProjectRemoval, setPendingProjectRemoval] = useState<RuntimeProjectSummary | null>(null);
	const [settingsProject, setSettingsProject] = useState<RuntimeProjectSummary | null>(null);
	const [deleteGitRepository, setDeleteGitRepository] = useState(false);
	const [devTestProjectState, setDevTestProjectState] = useState<{
		isCleaningUp: boolean;
		evidencePath: string | null;
	}>({ isCleaningUp: false, evidencePath: null });
	const [selfImprovementNotes, setSelfImprovementNotes] = useState("");
	const [isCreatingSelfImprovementProject, setIsCreatingSelfImprovementProject] = useState(false);
	const [registryEntries, setRegistryEntries] = useState<RuntimeDevTestRegistryEntry[]>([]);
	const [isRegistryLoading, setIsRegistryLoading] = useState(false);
	const [startingRegistryId, setStartingRegistryId] = useState<string | null>(null);

	// Load registry entries lazily — only when developer mode is active (DEV build).
	// We use a ref-guard so the load fires once per mount, not on every render.
	const registryLoadedRef = useRef(false);
	useEffect(() => {
		if (!import.meta.env.DEV || !developerModeEnabled || registryLoadedRef.current) {
			return;
		}
		registryLoadedRef.current = true;
		setIsRegistryLoading(true);
		listDevTestProjects(currentProjectId)
			.then((result) => setRegistryEntries(result.entries))
			.catch(() => {
				/* non-fatal — picker just shows empty */
			})
			.finally(() => setIsRegistryLoading(false));
	}, [developerModeEnabled, currentProjectId]);
	const [migratingProjectId, setMigratingProjectId] = useState<string | null>(null);
	const projectsWithHealthIssues = sortedProjects.filter((project) => (project.healthIssues?.length ?? 0) > 0);
	const isProjectRemovalPending = pendingProjectRemoval !== null && removingProjectId === pendingProjectRemoval.id;
	const pendingProjectTaskCount = pendingProjectRemoval
		? pendingProjectRemoval.taskCounts.backlog +
			pendingProjectRemoval.taskCounts.planning +
			pendingProjectRemoval.taskCounts.in_progress +
			pendingProjectRemoval.taskCounts.review +
			pendingProjectRemoval.taskCounts.completed +
			pendingProjectRemoval.taskCounts.trash
		: 0;

	const isMobile = useIsMobile();
	const [isMobileClosing, setIsMobileClosing] = useState(false);

	useEffect(() => {
		if (isMobile) {
			setSidebarCollapsed(true, false);
		}
		// Only auto-collapse when crossing the mobile breakpoint, not on every isCollapsed change.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [isMobile]);

	const setCollapsed = useCallback(
		(collapsed: boolean) => {
			if (isMobile && collapsed) {
				setIsMobileClosing(true);
				return;
			}
			setSidebarCollapsed(collapsed, !isMobile);
		},
		[isMobile, setSidebarCollapsed],
	);

	const handleMobileCloseAnimationEnd = useCallback(() => {
		setIsMobileClosing(false);
		setSidebarCollapsed(true, false);
	}, [setSidebarCollapsed]);

	const [isDragging, setIsDragging] = useState(false);
	const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);
	const previousBodyStyleRef = useRef<{ userSelect: string; cursor: string } | null>(null);

	const stopDrag = useCallback(() => {
		setIsDragging(false);
		const previousStyle = previousBodyStyleRef.current;
		if (previousStyle) {
			document.body.style.userSelect = previousStyle.userSelect;
			document.body.style.cursor = previousStyle.cursor;
			previousBodyStyleRef.current = null;
		}
		dragRef.current = null;
	}, []);

	useUnmount(stopDrag);

	const handleMouseMove = useCallback(
		(event: MouseEvent) => {
			if (!isDragging) {
				return;
			}
			const dragState = dragRef.current;
			if (!dragState) {
				return;
			}
			const delta = event.clientX - dragState.startX;
			const newWidth = dragState.startWidth + delta;
			if (newWidth < SIDEBAR_COLLAPSE_THRESHOLD) {
				if (!isCollapsed) {
					setCollapsed(true);
				}
				return;
			}
			if (isCollapsed) {
				setCollapsed(false);
			}
			setExpandedSidebarWidth(newWidth);
		},
		[isCollapsed, isDragging, setExpandedSidebarWidth, setCollapsed],
	);

	const handleMouseUp = useCallback(() => {
		if (!isDragging) {
			return;
		}
		stopDrag();
	}, [isDragging, stopDrag]);

	useWindowEvent("mousemove", isDragging ? handleMouseMove : null);
	useWindowEvent("mouseup", isDragging ? handleMouseUp : null);

	const startDrag = useCallback(
		(e: ReactMouseEvent) => {
			e.preventDefault();
			if (isDragging) {
				stopDrag();
			}
			dragRef.current = { startX: e.clientX, startWidth: isCollapsed ? COLLAPSED_WIDTH : sidebarWidth };
			setIsDragging(true);
			previousBodyStyleRef.current = {
				userSelect: document.body.style.userSelect,
				cursor: document.body.style.cursor,
			};
			document.body.style.userSelect = "none";
			document.body.style.cursor = "ew-resize";
		},
		[isCollapsed, isDragging, sidebarWidth, stopDrag],
	);

	if (isMobile && isCollapsed && !isMobileClosing) {
		return <></>;
	}

	const collapsedWidth = COLLAPSED_WIDTH;

	if (isCollapsed) {
		return (
			<aside
				className="flex flex-col items-center min-h-0 overflow-hidden bg-surface-1 relative shrink-0 py-2 gap-1.5"
				style={{
					width: collapsedWidth,
					minWidth: collapsedWidth,
					borderRight: "1px solid var(--color-divider)",
				}}
			>
				{!isMobile && (
					<div
						role="separator"
						aria-orientation="vertical"
						aria-label="Resize sidebar"
						onMouseDown={startDrag}
						className="absolute top-0 right-0 bottom-0 w-1.5 cursor-ew-resize z-10"
					/>
				)}
				{sortedProjects.map((project) => {
					const isCurrent = currentProjectId === project.id;
					const letter = project.name.charAt(0).toUpperCase();
					// Live activity must survive the collapse (David 2026-07-10): a pulsing green dot for agents
					// running now, steady gold for queued — same semantics as the expanded row's chips.
					const runningSessions = project.runningSessionCount ?? 0;
					const queuedSessions = project.queuedSessionCount ?? 0;
					return (
						<button
							key={project.id}
							type="button"
							title={
								runningSessions > 0
									? `${project.name} — ${runningSessions} agent${runningSessions === 1 ? "" : "s"} running`
									: queuedSessions > 0
										? `${project.name} — ${queuedSessions} queued`
										: project.name
							}
							onClick={() => {
								if (isMobile) {
									setCollapsed(false);
								}
								onSelectProject(project.id);
							}}
							className={cn(
								"relative rounded-md text-xs font-semibold shrink-0 border-0 cursor-pointer flex items-center justify-center",
								isMobile ? "w-11 h-11" : "w-8 h-8",
								isCurrent
									? "bg-accent text-accent-fg"
									: "bg-surface-3 text-text-secondary hover:text-text-primary hover:bg-surface-4",
								!isCurrent && runningSessions > 0 && "ring-1 ring-status-green/50",
							)}
						>
							{letter}
							{runningSessions > 0 ? (
								<span
									data-testid="collapsed-project-running-dot"
									className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-status-green shadow-[0_0_5px_var(--color-status-green)] animate-pulse"
								/>
							) : queuedSessions > 0 ? (
								<span
									data-testid="collapsed-project-queued-dot"
									className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-status-gold"
								/>
							) : null}
						</button>
					);
				})}
				<button
					type="button"
					title="Add project"
					onClick={onAddProject}
					disabled={removingProjectId !== null}
					className={cn(
						"rounded-md text-xs shrink-0 border-0 cursor-pointer flex items-center justify-center bg-transparent text-text-tertiary hover:text-text-secondary hover:bg-surface-2 mt-auto",
						isMobile ? "w-11 h-11" : "w-8 h-8",
					)}
				>
					<Plus size={16} />
				</button>
			</aside>
		);
	}

	return (
		<aside
			className={cn(
				"flex flex-col min-h-0 overflow-hidden bg-surface-1 shrink-0",
				isMobile ? "fixed inset-y-0 left-0 z-50 shadow-2xl" : "relative",
			)}
			onAnimationEnd={isMobileClosing ? handleMobileCloseAnimationEnd : undefined}
			style={
				isMobile
					? {
							width: "100vw",
							animation: isMobileClosing
								? "kb-sidebar-slide-out 200ms ease forwards"
								: "kb-sidebar-slide-in 200ms ease",
						}
					: {
							width: sidebarWidth,
							minWidth: SIDEBAR_MIN_EXPANDED_WIDTH,
							maxWidth: SIDEBAR_MAX_EXPANDED_WIDTH,
							borderRight: "1px solid var(--color-divider)",
						}
			}
		>
			{!isMobile && (
				<div
					role="separator"
					aria-orientation="vertical"
					aria-label="Resize sidebar"
					onMouseDown={startDrag}
					className="absolute top-0 right-0 bottom-0 w-1.5 cursor-ew-resize z-10"
				/>
			)}
			<div style={{ padding: "12px 12px 8px" }}>
				<div className="flex items-center justify-between">
					<div className="font-semibold text-base flex items-baseline gap-1.5">
						<NKleinMark
							size={18}
							accent="var(--color-accent)"
							accent2="var(--color-accent-2)"
							className="shrink-0 self-center"
						/>
						<span>
							<span className="text-accent">!</span>Klein
						</span>{" "}
						<span className="text-text-secondary font-normal text-xs">v{__APP_VERSION__}</span>
					</div>
					{isMobile ? (
						<ElementTooltip id="project.collapse-sidebar" side="bottom">
							<Button
								variant="ghost"
								size="sm"
								icon={<Plus size={16} className="rotate-45" />}
								onClick={() => setCollapsed(true)}
								aria-label="Close sidebar"
								className="min-w-[44px] min-h-[44px] -mr-2"
							/>
						</ElementTooltip>
					) : null}
				</div>
			</div>

			<>
				<div
					className="flex-1 min-h-0 overflow-y-auto overscroll-contain flex flex-col gap-1"
					style={{ padding: "4px 12px" }}
				>
					{sortedProjects.length === 0 && isLoadingProjects ? (
						<div style={{ padding: "4px 0" }}>
							{Array.from({ length: 3 }).map((_, index) => (
								<ProjectRowSkeleton key={`project-skeleton-${index}`} />
							))}
						</div>
					) : null}

					{sortedProjects.map((project) => (
						<ProjectRow
							key={project.id}
							project={project}
							isCurrent={currentProjectId === project.id}
							removingProjectId={removingProjectId}
							onSelect={(projectId) => {
								onSelectProject(projectId);
								if (isMobile) {
									setCollapsed(true);
								}
							}}
							onRemove={(projectId) => {
								const found = sortedProjects.find((item) => item.id === projectId);
								if (!found) {
									return;
								}
								setDeleteGitRepository(false);
								setPendingProjectRemoval(found);
							}}
							onOpenSettings={(projectId) => {
								const found = sortedProjects.find((item) => item.id === projectId);
								if (found) {
									setSettingsProject(found);
								}
							}}
						/>
					))}

					{!isLoadingProjects ? (
						<button
							type="button"
							className="kb-project-row flex cursor-pointer items-center gap-1.5 rounded-md text-text-secondary hover:text-text-primary"
							style={{ padding: "6px 8px" }}
							onClick={onAddProject}
							disabled={removingProjectId !== null}
						>
							<Plus size={14} className="shrink-0" />
							<span className="text-sm">Add Project</span>
						</button>
					) : null}
					<CodeIntelligencePanel
						workspaceId={currentProjectId}
						active={currentProjectId !== null}
						disabled={removingProjectId !== null}
						compact
						onOpenProjectSettings={() => {
							const found = sortedProjects.find((item) => item.id === currentProjectId);
							if (found) {
								setSettingsProject(found);
							}
						}}
					/>
					{projectsWithHealthIssues.length > 0 ? (
						<ProjectHealthCard
							projects={projectsWithHealthIssues}
							currentProjectId={currentProjectId}
							migratingProjectId={migratingProjectId}
							disabled={removingProjectId !== null}
							onInspect={(projectId) => {
								onSelectProject(projectId);
								if (isMobile) {
									setCollapsed(true);
								}
							}}
							onRemove={(project) => {
								setDeleteGitRepository(false);
								setPendingProjectRemoval(project);
							}}
							onMigrateArtifacts={async (project) => {
								if (
									!window.confirm(
										"Copy this accidental legacy task workspace project's plan artifacts into the detected parent project?",
									)
								) {
									return;
								}
								setMigratingProjectId(project.id);
								try {
									const migrated = await migrateAccidentalProjectArtifacts(currentProjectId, project.id);
									if (!migrated.ok) {
										throw new Error(migrated.error ?? "Could not migrate plan artifacts.");
									}
									showAppToast({
										intent: "success",
										icon: "clipboard",
										message: `Migrated ${migrated.migratedArtifacts} plan artifact${migrated.migratedArtifacts === 1 ? "" : "s"}.`,
										timeout: 6000,
									});
								} catch (error) {
									const message = error instanceof Error ? error.message : String(error);
									showAppToast({ intent: "danger", icon: "warning-sign", message, timeout: 8000 });
								} finally {
									setMigratingProjectId(null);
								}
							}}
						/>
					) : null}
					{/* dev source tree required -> DEV build AND developer mode */}
					{import.meta.env.DEV && developerModeEnabled ? (
						<DevTestProjectCard
							disabled={removingProjectId !== null || devTestProjectState.isCleaningUp}
							isCleaningUp={devTestProjectState.isCleaningUp}
							isCreatingSelfImprovementProject={isCreatingSelfImprovementProject}
							evidencePath={devTestProjectState.evidencePath}
							selfImprovementNotes={selfImprovementNotes}
							registryEntries={registryEntries}
							isRegistryLoading={isRegistryLoading}
							startingRegistryId={startingRegistryId}
							onSelfImprovementNotesChange={setSelfImprovementNotes}
							onRunById={async (registryId) => {
								setStartingRegistryId(registryId);
								try {
									const created = await createDevTestProject(currentProjectId, { registryId });
									if (!created.ok || !created.project) {
										throw new Error(created.error ?? "Could not create the dev test project.");
									}
									setDevTestProjectState((current) => ({
										...current,
										evidencePath: created.evidenceRootPath,
									}));
									onSelectProject(created.project.id);
									if (created.task) {
										const trpcClient = getRuntimeTrpcClient(created.project.id);
										const started = await trpcClient.runtime.startTaskSession.mutate({
											taskId: created.task.id,
											prompt: created.task.prompt,
											taskTitle: created.task.title,
											filesLikelyTouched: created.task.filesLikelyTouched,
											startInPlanMode: created.task.startInPlanMode,
											baseRef: created.task.baseRef,
											agentId: created.task.agentId,
											nkleinSettings: created.task.nkleinSettings,
										});
										if (!started.ok) {
											throw new Error(started.error ?? "Dev test task could not be started.");
										}
										const workspaceState = await fetchWorkspaceState(created.project.id);
										const targetColumnId = created.task.startInPlanMode ? "planning" : "in_progress";
										const moved = moveTaskToColumn(workspaceState.board, created.task.id, targetColumnId, {
											insertAtTop: true,
										});
										if (moved.moved) {
											await saveWorkspaceState(created.project.id, {
												board: moved.board,
												expectedRevision: workspaceState.revision,
											});
											await trpcClient.workspace.notifyStateUpdated.mutate();
										}
									}
									showAppToast({
										intent: "success",
										icon: "check",
										message: `Dev test project "${created.scenario?.title ?? registryId}" created.`,
										timeout: 5000,
									});
								} catch (error) {
									const message = error instanceof Error ? error.message : String(error);
									showAppToast({ intent: "danger", icon: "warning-sign", message, timeout: 8000 });
								} finally {
									setStartingRegistryId(null);
								}
							}}
							onCopyEvidence={async () => {
								if (!devTestProjectState.evidencePath) {
									return;
								}
								await navigator.clipboard.writeText(devTestProjectState.evidencePath);
								showAppToast({
									intent: "success",
									icon: "clipboard",
									message: "Evidence path copied.",
									timeout: 3000,
								});
							}}
							onCleanup={async () => {
								setDevTestProjectState((current) => ({ ...current, isCleaningUp: true }));
								try {
									const cleaned = await cleanupDevTestProjects(currentProjectId);
									if (!cleaned.ok) {
										throw new Error(cleaned.error ?? "Could not clean up dev test projects.");
									}
									setDevTestProjectState({
										isCleaningUp: false,
										evidencePath: null,
									});
									showAppToast({
										intent: "success",
										icon: "trash",
										message: `Removed ${cleaned.removedProjects} dev projects.`,
										timeout: 5000,
									});
								} catch (error) {
									const message = error instanceof Error ? error.message : String(error);
									showAppToast({ intent: "danger", icon: "warning-sign", message, timeout: 8000 });
								} finally {
									setDevTestProjectState((current) => ({ ...current, isCleaningUp: false }));
								}
							}}
							onCreateSelfImprovementProject={async () => {
								if (
									!window.confirm(
										"Create a !Klein self-improvement project from the currently running development checkout?",
									)
								) {
									return;
								}
								setIsCreatingSelfImprovementProject(true);
								try {
									const created = await createSelfImprovementProject(currentProjectId, {
										confirmSelfProject: true,
										notes: selfImprovementNotes,
										evidenceBundlePath: devTestProjectState.evidencePath ?? undefined,
									});
									if (!created.ok || !created.project || !created.task) {
										throw new Error(created.error ?? "Could not create the self-improvement project.");
									}
									onSelectProject(created.project.id);
									setSelfImprovementNotes("");
									showAppToast({
										intent: "success",
										icon: "check",
										message: "Self-improvement project created with a seeded Backlog task.",
										timeout: 5000,
									});
								} catch (error) {
									const message = error instanceof Error ? error.message : String(error);
									showAppToast({ intent: "danger", icon: "warning-sign", message, timeout: 8000 });
								} finally {
									setIsCreatingSelfImprovementProject(false);
								}
							}}
						/>
					) : null}
				</div>
				<ShortcutsCard />
				<ProjectSupportFooter
					shouldShowFeaturebaseFeedback={shouldShowFeaturebaseFeedback}
					featurebaseFeedbackState={featurebaseFeedbackState}
				/>
			</>
			<AlertDialog
				open={pendingProjectRemoval !== null}
				onOpenChange={(open) => {
					if (!open && !isProjectRemovalPending) {
						setPendingProjectRemoval(null);
						setDeleteGitRepository(false);
					}
				}}
			>
				<AlertDialogHeader>
					<AlertDialogTitle>Remove Project</AlertDialogTitle>
				</AlertDialogHeader>
				<AlertDialogBody>
					<AlertDialogDescription asChild>
						<div className="flex flex-col gap-3">
							<p>{pendingProjectRemoval ? pendingProjectRemoval.name : "This project"}</p>
							<p className="text-text-primary">
								This will delete all project tasks ({pendingProjectTaskCount}), remove task
								workspaces/worktrees, and stop any running processes for this project.
							</p>
							<p className="text-text-primary">This action cannot be undone.</p>
							{pendingProjectRemoval?.gitRepositoryCreatedByKanban ? (
								<label className="flex cursor-pointer items-start gap-2 rounded-md border border-border bg-surface-2 p-3">
									<input
										type="checkbox"
										checked={deleteGitRepository}
										onChange={(event) => setDeleteGitRepository(event.target.checked)}
										disabled={isProjectRemovalPending}
										className="mt-0.5 accent-accent"
									/>
									<span>
										<span className="block text-text-primary">
											Also remove Git metadata created by !Klein
										</span>
										<span className="mt-1 block text-[12px] text-text-secondary">
											Deletes the project folder&apos;s .git directory and history. Project files remain in
											place.
										</span>
									</span>
								</label>
							) : null}
						</div>
					</AlertDialogDescription>
				</AlertDialogBody>
				<AlertDialogFooter>
					<AlertDialogCancel asChild>
						<Button
							variant="default"
							disabled={isProjectRemovalPending}
							onClick={() => {
								if (!isProjectRemovalPending) {
									setPendingProjectRemoval(null);
									setDeleteGitRepository(false);
								}
							}}
						>
							Cancel
						</Button>
					</AlertDialogCancel>
					<AlertDialogAction asChild>
						<Button
							variant="danger"
							disabled={isProjectRemovalPending}
							onClick={async () => {
								if (!pendingProjectRemoval) {
									return;
								}
								const removed = await onRemoveProject(pendingProjectRemoval.id, {
									deleteGitRepository,
								});
								if (removed) {
									setPendingProjectRemoval(null);
									setDeleteGitRepository(false);
								}
							}}
						>
							{isProjectRemovalPending ? (
								<>
									<Spinner size={14} />
									Removing...
								</>
							) : (
								"Remove Project"
							)}
						</Button>
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialog>
			<ProjectSettingsDialog
				open={settingsProject !== null}
				onOpenChange={(open) => {
					if (!open) {
						setSettingsProject(null);
					}
				}}
				workspaceId={settingsProject?.id ?? null}
				projectName={settingsProject?.name ?? null}
				autoResumeEnabled={settingsProject?.autoResumeEnabled === true}
			/>
		</aside>
	);
}

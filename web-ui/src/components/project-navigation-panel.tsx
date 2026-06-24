import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import {
	AlertTriangle,
	Clipboard,
	Ellipsis,
	ExternalLink,
	FlaskConical,
	Info,
	Lightbulb,
	Play,
	Plus,
	Settings,
	Trash2,
} from "lucide-react";
import { type MouseEvent as ReactMouseEvent, useCallback, useEffect, useRef, useState } from "react";
import { showAppToast } from "@/components/app-toaster";
import { CodeIntelligencePanel } from "@/components/code-intelligence-panel";
import { canShowFeaturebaseFeedbackButton } from "@/components/featurebase-feedback-button";
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
import { NKleinMark } from "@/components/ui/nklein-mark";
import { Spinner } from "@/components/ui/spinner";
import type { FeaturebaseFeedbackState } from "@/hooks/use-featurebase-feedback-widget";
import { useIsMobile } from "@/hooks/use-is-mobile";
import {
	cleanupDevTestProjects,
	createDevTestProject,
	createSelfImprovementProject,
	migrateAccidentalProjectArtifacts,
} from "@/runtime/runtime-config-query";
import { getRuntimeTrpcClient } from "@/runtime/trpc-client";
import type {
	RuntimeAgentId,
	RuntimeDevTestProjectPreset,
	RuntimeNKleinProviderSettings,
	RuntimeProjectHealthIssue,
	RuntimeProjectSummary,
} from "@/runtime/types";
import { fetchWorkspaceState, saveWorkspaceState } from "@/runtime/workspace-state-query";
import { moveTaskToColumn } from "@/state/board-state";
import { formatPathForDisplay } from "@/utils/path-display";
import { useUnmount, useWindowEvent } from "@/utils/react-use";

const COLLAPSED_WIDTH = 48;
const SIDEBAR_COLLAPSE_THRESHOLD = 120;
const SIDEBAR_MIN_EXPANDED_WIDTH = 200;
const SIDEBAR_MAX_EXPANDED_WIDTH = 600;
const GITHUB_ISSUES_URL = "https://github.com/dabertram/kanban/issues";

interface TaskCountBadge {
	id: string;
	title: string;
	shortLabel: string;
	toneClassName: string;
	count: number;
}

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
		runningPreset: RuntimeDevTestProjectPreset | null;
		isCleaningUp: boolean;
		evidencePath: string | null;
	}>({ runningPreset: null, isCleaningUp: false, evidencePath: null });
	const [selfImprovementNotes, setSelfImprovementNotes] = useState("");
	const [isCreatingSelfImprovementProject, setIsCreatingSelfImprovementProject] = useState(false);
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
					return (
						<button
							key={project.id}
							type="button"
							title={project.name}
							onClick={() => {
								if (isMobile) {
									setCollapsed(false);
								}
								onSelectProject(project.id);
							}}
							className={cn(
								"rounded-md text-xs font-semibold shrink-0 border-0 cursor-pointer flex items-center justify-center",
								isMobile ? "w-11 h-11" : "w-8 h-8",
								isCurrent
									? "bg-accent text-accent-fg"
									: "bg-surface-3 text-text-secondary hover:text-text-primary hover:bg-surface-4",
							)}
						>
							{letter}
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
						<NKleinMark size={18} className="text-text-primary shrink-0 self-center" />
						!Klein <span className="text-text-secondary font-normal text-xs">v{__APP_VERSION__}</span>
					</div>
					{isMobile ? (
						<Button
							variant="ghost"
							size="sm"
							icon={<Plus size={16} className="rotate-45" />}
							onClick={() => setCollapsed(true)}
							aria-label="Close sidebar"
							className="min-w-[44px] min-h-[44px] -mr-2"
						/>
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
						onError={(message) => {
							if (message) {
								showAppToast({ intent: "danger", icon: "warning-sign", message, timeout: 7000 });
							}
						}}
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
							disabled={
								removingProjectId !== null ||
								devTestProjectState.runningPreset !== null ||
								devTestProjectState.isCleaningUp
							}
							runningPreset={devTestProjectState.runningPreset}
							isCleaningUp={devTestProjectState.isCleaningUp}
							isCreatingSelfImprovementProject={isCreatingSelfImprovementProject}
							evidencePath={devTestProjectState.evidencePath}
							selfImprovementNotes={selfImprovementNotes}
							onSelfImprovementNotesChange={setSelfImprovementNotes}
							onRun={async (preset) => {
								setDevTestProjectState((current) => ({ ...current, runningPreset: preset }));
								try {
									const created = await createDevTestProject(currentProjectId, { preset });
									if (!created.ok || !created.project) {
										throw new Error(created.error ?? "Could not create the dev test project.");
									}
									setDevTestProjectState({
										runningPreset: preset,
										isCleaningUp: false,
										evidencePath: created.evidenceRootPath,
									});
									onSelectProject(created.project.id);
									if (
										preset === "mid_task" ||
										preset === "complex_dag" ||
										preset === "audio_vst" ||
										preset === "daw_foundation"
									) {
										if (!created.task) {
											throw new Error("Dev test project did not include a startable task.");
										}
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
										message:
											preset === "complex_dag"
												? "Complex product test project created with one decomposition task."
												: preset === "audio_vst"
													? "Audio VST test project created with one decomposition task."
													: preset === "daw_foundation"
														? "DAW foundation test project created with one decomposition task."
														: "Mid task test project created with one decomposition task.",
										timeout: 5000,
									});
								} catch (error) {
									const message = error instanceof Error ? error.message : String(error);
									showAppToast({ intent: "danger", icon: "warning-sign", message, timeout: 8000 });
								} finally {
									setDevTestProjectState((current) => ({ ...current, runningPreset: null }));
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
										runningPreset: null,
										isCleaningUp: false,
										evidencePath: null,
									});
									showAppToast({
										intent: "success",
										icon: "trash",
										message: `Removed ${cleaned.removedProjects} dev projects and ${cleaned.removedTaskWorktrees} task workspaces.`,
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
			/>
		</aside>
	);
}

function ProjectHealthCard({
	projects,
	currentProjectId,
	migratingProjectId,
	disabled,
	onInspect,
	onRemove,
	onMigrateArtifacts,
}: {
	projects: RuntimeProjectSummary[];
	currentProjectId: string | null;
	migratingProjectId: string | null;
	disabled: boolean;
	onInspect: (projectId: string) => void;
	onRemove: (project: RuntimeProjectSummary) => void;
	onMigrateArtifacts: (project: RuntimeProjectSummary, issue: RuntimeProjectHealthIssue) => Promise<void>;
}): React.ReactElement {
	return (
		<div className="mt-2 rounded-md border border-status-orange/60 bg-status-orange/10 px-3 py-2.5">
			<div className="mb-2 flex items-start gap-2">
				<AlertTriangle size={14} className="mt-0.5 shrink-0 text-status-orange" />
				<div className="min-w-0">
					<p className="m-0 text-xs font-semibold text-text-primary">Project Health</p>
					<p className="mt-1 mb-0 text-[11px] leading-4 text-text-secondary">
						Diagnostics need review before cleanup or continued work.
					</p>
				</div>
			</div>
			<div className="grid gap-2">
				{projects.map((project) => {
					const issues = project.healthIssues ?? [];
					if (issues.length === 0) {
						return null;
					}
					const isMigrating = migratingProjectId === project.id;
					const primaryIssue = issues[0];
					const migratableIssue = issues.find((issue) => issue.canMigrateArtifacts);
					const canRemoveProject = issues.some((issue) => issue.canRemove);
					const parentPath = primaryIssue?.parentWorkspacePath
						? formatPathForDisplay(primaryIssue.parentWorkspacePath)
						: "No parent detected";
					return (
						<div key={project.id} className="rounded-md border border-border bg-surface-2 px-2.5 py-2">
							<div className="flex items-start justify-between gap-2">
								<div className="min-w-0">
									<p className="m-0 truncate text-xs font-semibold text-text-primary">{project.name}</p>
									<p className="mt-1 mb-0 truncate font-mono text-[10px] text-text-tertiary">{parentPath}</p>
								</div>
								<span
									className={cn(
										"shrink-0 rounded-sm px-1.5 py-0.5 text-[10px] font-semibold",
										issues.some((issue) => issue.severity === "error")
											? "bg-status-red/20 text-status-red"
											: "bg-status-orange/20 text-status-orange",
									)}
								>
									{issues.length} issue{issues.length === 1 ? "" : "s"}
								</span>
							</div>
							<div className="mt-1.5 mb-2 grid gap-1.5">
								{issues.map((issue) => (
									<div key={`${issue.kind}:${issue.taskId ?? "project"}`} className="text-[11px] leading-4">
										<div className="flex items-center justify-between gap-2">
											<span className="font-medium text-text-primary">{issue.title}</span>
											{issue.artifactCount > 0 ? (
												<span className="shrink-0 text-text-tertiary">
													{issue.artifactCount} artifact{issue.artifactCount === 1 ? "" : "s"}
												</span>
											) : null}
										</div>
										<p className="m-0 text-text-secondary">{issue.message}</p>
									</div>
								))}
							</div>
							<div className="grid grid-cols-3 gap-1.5">
								<Button
									size="sm"
									variant={currentProjectId === project.id ? "primary" : "default"}
									onClick={() => onInspect(project.id)}
									disabled={disabled || isMigrating}
								>
									Inspect
								</Button>
								<Button
									size="sm"
									variant="default"
									icon={isMigrating ? <Spinner size={14} /> : <Clipboard size={14} />}
									onClick={() => {
										if (migratableIssue) {
											void onMigrateArtifacts(project, migratableIssue);
										}
									}}
									disabled={disabled || isMigrating || !migratableIssue}
								>
									Migrate
								</Button>
								<Button
									size="sm"
									variant="ghost"
									icon={<Trash2 size={14} />}
									onClick={() => onRemove(project)}
									disabled={disabled || isMigrating || !canRemoveProject}
								>
									Remove
								</Button>
							</div>
						</div>
					);
				})}
			</div>
		</div>
	);
}

function DevTestProjectCard({
	disabled,
	runningPreset,
	isCleaningUp,
	isCreatingSelfImprovementProject,
	evidencePath,
	selfImprovementNotes,
	onSelfImprovementNotesChange,
	onRun,
	onCopyEvidence,
	onCleanup,
	onCreateSelfImprovementProject,
}: {
	disabled: boolean;
	runningPreset: RuntimeDevTestProjectPreset | null;
	isCleaningUp: boolean;
	isCreatingSelfImprovementProject: boolean;
	evidencePath: string | null;
	selfImprovementNotes: string;
	onSelfImprovementNotesChange: (value: string) => void;
	onRun: (preset: RuntimeDevTestProjectPreset) => Promise<void>;
	onCopyEvidence: () => Promise<void>;
	onCleanup: () => Promise<void>;
	onCreateSelfImprovementProject: () => Promise<void>;
}): React.ReactElement {
	const isRunningMidTask = runningPreset === "mid_task";
	const isRunningComplexProject = runningPreset === "complex_dag";
	const isRunningAudioVstProject = runningPreset === "audio_vst";
	const isRunningDawFoundationProject = runningPreset === "daw_foundation";
	const isBusy = disabled || isCreatingSelfImprovementProject;

	return (
		<div className="mt-2 rounded-md border border-border bg-surface-2 px-3 py-2.5">
			<div className="mb-2 flex items-start gap-2">
				<FlaskConical size={14} className="mt-0.5 shrink-0 text-status-purple" />
				<div className="min-w-0">
					<p className="m-0 text-xs font-semibold text-text-primary">Dev Test Scenarios</p>
					<p className="mt-1 mb-0 text-[11px] leading-4 text-text-secondary">
						Create fixture projects or load the current dev checkout for !Klein self-improvement.
					</p>
				</div>
			</div>
			<div className="grid gap-2">
				<div className="rounded-md border border-border bg-surface-1 px-2 py-2">
					<div className="mb-2 flex items-start gap-2">
						<Lightbulb size={14} className="mt-0.5 shrink-0 text-status-gold" />
						<div className="min-w-0">
							<p className="m-0 text-[12px] font-semibold text-text-primary">Self-improvement</p>
							<p className="mt-1 mb-0 text-[11px] leading-4 text-text-secondary">
								Use the currently running code and seed a Backlog task with optional notes.
							</p>
						</div>
					</div>
					<textarea
						value={selfImprovementNotes}
						onChange={(event) => onSelfImprovementNotesChange(event.currentTarget.value)}
						placeholder="Optional notes for the seeded task"
						rows={3}
						className="mb-2 min-h-16 w-full resize-y rounded-md border border-border-bright bg-surface-2 px-2 py-1.5 text-[12px] text-text-primary placeholder:text-text-tertiary focus:border-border-focus focus:outline-none"
						disabled={isBusy}
					/>
					<Button
						size="sm"
						variant="primary"
						icon={isCreatingSelfImprovementProject ? <Spinner size={14} /> : <Lightbulb size={14} />}
						disabled={isBusy}
						onClick={() => {
							void onCreateSelfImprovementProject();
						}}
						fill
					>
						{isCreatingSelfImprovementProject ? "Creating..." : "Create self-improvement project"}
					</Button>
				</div>
				<Button
					size="sm"
					variant="default"
					icon={isRunningMidTask ? <Spinner size={14} /> : <Play size={14} />}
					disabled={isBusy}
					onClick={() => {
						if (!window.confirm("Create a marked !Klein dev-test project and make it the active project?")) {
							return;
						}
						void onRun("mid_task");
					}}
					fill
				>
					{isRunningMidTask ? "Creating..." : "Create mid task project"}
				</Button>
				<Button
					size="sm"
					variant="default"
					icon={isRunningComplexProject ? <Spinner size={14} /> : <FlaskConical size={14} />}
					disabled={isBusy}
					onClick={() => {
						if (
							!window.confirm("Create a marked !Klein complex dev-test project and make it the active project?")
						) {
							return;
						}
						void onRun("complex_dag");
					}}
					fill
				>
					{isRunningComplexProject ? "Creating..." : "Create complex product project"}
				</Button>
				<Button
					size="sm"
					variant="default"
					icon={isRunningAudioVstProject ? <Spinner size={14} /> : <FlaskConical size={14} />}
					disabled={isBusy}
					onClick={() => {
						if (
							!window.confirm(
								"Create a marked !Klein audio VST dev-test project and make it the active project?",
							)
						) {
							return;
						}
						void onRun("audio_vst");
					}}
					fill
				>
					{isRunningAudioVstProject ? "Creating..." : "Create audio VST project"}
				</Button>
				<Button
					size="sm"
					variant="default"
					icon={isRunningDawFoundationProject ? <Spinner size={14} /> : <FlaskConical size={14} />}
					disabled={isBusy}
					onClick={() => {
						if (
							!window.confirm(
								"Create a marked !Klein DAW foundation dev-test project and make it the active project?",
							)
						) {
							return;
						}
						void onRun("daw_foundation");
					}}
					fill
				>
					{isRunningDawFoundationProject ? "Creating..." : "Create DAW foundation project"}
				</Button>
				{evidencePath ? (
					<Button
						size="sm"
						variant="ghost"
						icon={<Clipboard size={14} />}
						disabled={isBusy || runningPreset !== null}
						onClick={() => {
							void onCopyEvidence();
						}}
						aria-label="Copy dev scenario evidence"
						fill
					>
						Copy evidence
					</Button>
				) : null}
				<Button
					size="sm"
					variant="ghost"
					icon={isCleaningUp ? <Spinner size={14} /> : <Trash2 size={14} />}
					disabled={isBusy}
					onClick={() => {
						if (
							!window.confirm(
								"Delete marked !Klein dev-test projects, their task workspaces, and saved dev-test task patches?",
							)
						) {
							return;
						}
						void onCleanup();
					}}
					fill
				>
					{isCleaningUp ? "Cleaning..." : "Delete dev workspaces"}
				</Button>
			</div>
			{evidencePath ? (
				<p className="mt-2 mb-0 truncate font-mono text-[11px] text-text-tertiary" title={evidencePath}>
					{evidencePath}
				</p>
			) : null}
		</div>
	);
}

function ProjectSupportFooter({
	shouldShowFeaturebaseFeedback,
	featurebaseFeedbackState,
}: {
	shouldShowFeaturebaseFeedback: boolean;
	featurebaseFeedbackState?: FeaturebaseFeedbackState;
}): React.ReactElement {
	const isOpening = featurebaseFeedbackState?.authState === "loading";

	const handleAction = () => {
		if (shouldShowFeaturebaseFeedback) {
			void featurebaseFeedbackState?.openFeedbackWidget();
		} else {
			window.open(GITHUB_ISSUES_URL, "_blank");
		}
	};

	const actionLabel = shouldShowFeaturebaseFeedback ? (isOpening ? "Opening..." : "Send feedback") : "Report issue";

	return (
		<div style={{ padding: "4px 12px 12px" }}>
			<div className="flex items-start gap-2 rounded-md border border-border bg-surface-2 px-3 py-2.5">
				<Info size={14} className="mt-px shrink-0 text-text-tertiary" />
				<div className="flex flex-col gap-1.5">
					<p className="m-0 text-xs text-text-secondary">
						!Klein is in beta. Help us improve by sharing your experience.
					</p>
					<button
						type="button"
						className="m-0 flex cursor-pointer items-center gap-1 self-start border-none bg-transparent p-0 text-xs font-semibold text-text-secondary hover:text-text-primary active:text-text-tertiary disabled:cursor-default disabled:opacity-50"
						disabled={shouldShowFeaturebaseFeedback && isOpening}
						onClick={handleAction}
					>
						{actionLabel} {!isOpening && <ExternalLink size={11} />}
					</button>
				</div>
			</div>
		</div>
	);
}

function ProjectRowSkeleton(): React.ReactElement {
	return (
		<div
			className="flex items-center gap-1.5"
			style={{
				padding: "6px 8px",
			}}
		>
			<div className="flex-1 min-w-0">
				<div
					className="kb-skeleton"
					style={{
						height: 14,
						width: "58%",
						borderRadius: 3,
						marginBottom: 6,
					}}
				/>
				<div
					className="kb-skeleton font-mono"
					style={{
						height: 10,
						width: "86%",
						borderRadius: 3,
						marginBottom: 6,
					}}
				/>
				<div className="flex gap-1">
					<div className="kb-skeleton" style={{ height: 18, width: 30, borderRadius: 999 }} />
					<div className="kb-skeleton" style={{ height: 18, width: 30, borderRadius: 999 }} />
					<div className="kb-skeleton" style={{ height: 18, width: 30, borderRadius: 999 }} />
				</div>
			</div>
		</div>
	);
}

function ProjectRow({
	project,
	isCurrent,
	removingProjectId,
	onSelect,
	onRemove,
	onOpenSettings,
}: {
	project: RuntimeProjectSummary;
	isCurrent: boolean;
	removingProjectId: string | null;
	onSelect: (id: string) => void;
	onRemove: (id: string) => void;
	onOpenSettings: (id: string) => void;
}): React.ReactElement {
	const displayPath = formatPathForDisplay(project.path);
	const isRemovingProject = removingProjectId === project.id;
	const hasAnyProjectRemoval = removingProjectId !== null;
	const [isMenuOpen, setIsMenuOpen] = useState(false);
	const taskCountBadges: TaskCountBadge[] = [
		{
			id: "backlog",
			title: "Backlog",
			shortLabel: "B",
			toneClassName: "bg-text-primary/15 text-text-primary",
			count: project.taskCounts.backlog,
		},
		{
			id: "planning",
			title: "Planning",
			shortLabel: "P",
			toneClassName: "bg-status-purple/20 text-status-purple",
			count: project.taskCounts.planning,
		},
		{
			id: "in_progress",
			title: "In Progress",
			shortLabel: "IP",
			toneClassName: "bg-accent/20 text-accent",
			count: project.taskCounts.in_progress,
		},
		{
			id: "review",
			title: "Review",
			shortLabel: "R",
			toneClassName: "bg-accent-2/20 text-accent-2",
			count: project.taskCounts.review,
		},
		{
			id: "completed",
			title: "Completed",
			shortLabel: "C",
			toneClassName: "bg-status-green/20 text-status-green",
			count: project.taskCounts.completed,
		},
		{
			id: "trash",
			title: "Trash",
			shortLabel: "T",
			toneClassName: "bg-status-red/20 text-status-red",
			count: project.taskCounts.trash,
		},
	].filter((item) => item.count > 0);

	return (
		<div
			role="button"
			tabIndex={0}
			onClick={() => onSelect(project.id)}
			onKeyDown={(e) => {
				if (e.key === "Enter" || e.key === " ") {
					e.preventDefault();
					onSelect(project.id);
				}
			}}
			className={cn("kb-project-row cursor-pointer rounded-md", isCurrent && "kb-project-row-selected")}
			style={{
				display: "flex",
				alignItems: "center",
				gap: 6,
				padding: "6px 8px",
			}}
		>
			<div className="flex-1 min-w-0">
				<div
					className={cn(
						"font-medium whitespace-nowrap overflow-hidden text-ellipsis text-sm",
						isCurrent ? "text-accent-fg" : "text-text-primary",
					)}
				>
					{project.name}
				</div>
				<div
					className={cn(
						"font-mono text-[10px] whitespace-nowrap overflow-hidden text-ellipsis",
						isCurrent ? "text-accent-fg/60" : "text-text-secondary",
					)}
				>
					{displayPath}
				</div>
				{taskCountBadges.length > 0 ? (
					<div className="flex gap-1 mt-1">
						{taskCountBadges.map((badge) => (
							<span
								key={badge.id}
								className={cn(
									"inline-flex items-center gap-1 rounded-full text-[10px] px-1.5 py-px font-medium",
									isCurrent ? "bg-accent-fg/20 text-accent-fg" : badge.toneClassName,
								)}
								title={badge.title}
							>
								<span>{badge.shortLabel}</span>
								<span style={{ opacity: 0.4 }}>|</span>
								<span>{badge.count}</span>
							</span>
						))}
					</div>
				) : null}
			</div>
			<div className="kb-project-row-actions flex items-center" style={isMenuOpen ? { opacity: 1 } : undefined}>
				<DropdownMenu.Root open={isMenuOpen} onOpenChange={setIsMenuOpen}>
					<DropdownMenu.Trigger asChild>
						<Button
							variant="ghost"
							size="sm"
							icon={isRemovingProject ? <Spinner size={12} /> : <Ellipsis size={14} />}
							disabled={hasAnyProjectRemoval && !isRemovingProject}
							className={
								isCurrent
									? "text-accent-fg hover:bg-accent-fg/20 hover:text-accent-fg active:bg-accent-fg/30"
									: undefined
							}
							onClick={(e) => {
								e.stopPropagation();
							}}
							aria-label="Project actions"
						/>
					</DropdownMenu.Trigger>
					<DropdownMenu.Portal>
						<DropdownMenu.Content
							side="bottom"
							align="end"
							sideOffset={4}
							className="z-50 min-w-[140px] rounded-md border border-border-bright bg-surface-1 p-1 shadow-lg"
							onCloseAutoFocus={(event) => event.preventDefault()}
						>
							<DropdownMenu.Item
								className="flex items-center gap-2 rounded-sm px-2 py-1.5 text-[13px] text-text-primary cursor-pointer outline-none data-[highlighted]:bg-surface-3"
								onSelect={() => onOpenSettings(project.id)}
							>
								<Settings size={14} />
								Project settings
							</DropdownMenu.Item>
							<DropdownMenu.Item
								className="flex items-center gap-2 rounded-sm px-2 py-1.5 text-[13px] text-status-red cursor-pointer outline-none data-[highlighted]:bg-surface-3"
								onSelect={() => onRemove(project.id)}
							>
								<Trash2 size={14} />
								Delete
							</DropdownMenu.Item>
						</DropdownMenu.Content>
					</DropdownMenu.Portal>
				</DropdownMenu.Root>
			</div>
		</div>
	);
}

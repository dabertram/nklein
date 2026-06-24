import { AlertTriangle, Clipboard, Trash2 } from "lucide-react";
import type React from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { Spinner } from "@/components/ui/spinner";
import type { RuntimeProjectHealthIssue, RuntimeProjectSummary } from "@/runtime/types";
import { formatPathForDisplay } from "@/utils/path-display";

/**
 * The project-health warning card for the navigation sidebar, extracted from the oversized
 * `project-navigation-panel.tsx` (todo §5.U). For each project with diagnostics it lists the health issues and offers
 * inspect / migrate-artifacts / remove actions. Self-contained: drives the `projects` list + the action callbacks.
 */
export function ProjectHealthCard({
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

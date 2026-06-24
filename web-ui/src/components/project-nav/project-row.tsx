import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Ellipsis, Settings, Trash2 } from "lucide-react";
import type React from "react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { ElementTooltip } from "@/components/ui/element-tooltip";
import { Spinner } from "@/components/ui/spinner";
import type { RuntimeProjectSummary } from "@/runtime/types";
import { formatPathForDisplay } from "@/utils/path-display";

/**
 * The project list row (and its loading skeleton) for the navigation sidebar, extracted from the oversized
 * `project-navigation-panel.tsx` (todo §5.U). Shows the project name + path, per-column task-count badges, and a
 * per-project actions menu (settings / delete). Self-contained: drives the `project` + select/remove/settings
 * callbacks.
 */

interface TaskCountBadge {
	id: string;
	title: string;
	shortLabel: string;
	toneClassName: string;
	count: number;
}

export function ProjectRowSkeleton(): React.ReactElement {
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

export function ProjectRow({
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
					<ElementTooltip id="project.actions" side="right">
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
					</ElementTooltip>
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

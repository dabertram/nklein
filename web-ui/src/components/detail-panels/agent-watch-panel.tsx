import type { RuntimeNKleinTeamProgressEvent, RuntimeTaskSessionSummary } from "@runtime-contract";
import { Activity, FilePen, FilePlus, FileX, Terminal as TerminalIcon, Wrench } from "lucide-react";
import { cn } from "@/components/ui/cn";
import { useAgentActivityTimeline } from "@/runtime/use-agent-activity-timeline";
import { useRuntimeWorkspaceChanges } from "@/runtime/use-runtime-workspace-changes";

/**
 * "Watch the agent's hands" panel (OpenHands-inspired): an at-a-glance live view of one agent working like a
 * remote developer — its current state, an accumulated activity stream (every tool/step it takes), and the
 * files it is changing in this run. The interactive terminal lives in its own tab; this panel links to it.
 *
 * Built entirely on data the runtime already broadcasts (session summaries + team progress + workspace
 * changes), so it works without backend changes.
 */

const FILE_STATUS_ICON: Record<string, React.ReactElement> = {
	added: <FilePlus size={13} className="text-status-green" />,
	modified: <FilePen size={13} className="text-status-blue" />,
	deleted: <FileX size={13} className="text-status-red" />,
};

function formatElapsed(startedAt: number | null): string {
	if (!startedAt) {
		return "—";
	}
	const seconds = Math.max(0, Math.round((Date.now() - startedAt) / 1000));
	if (seconds < 60) {
		return `${seconds}s`;
	}
	const minutes = Math.floor(seconds / 60);
	return minutes < 60 ? `${minutes}m ${seconds % 60}s` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function formatClock(at: number): string {
	return new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export interface AgentWatchPanelProps {
	taskId: string;
	workspaceId: string | null;
	baseRef: string | null;
	summary: RuntimeTaskSessionSummary | null;
	teamProgress?: readonly RuntimeNKleinTeamProgressEvent[];
	stateVersion?: number;
	onOpenTerminal?: () => void;
}

export function AgentWatchPanel({
	taskId,
	workspaceId,
	baseRef,
	summary,
	teamProgress = [],
	stateVersion = 0,
	onOpenTerminal,
}: AgentWatchPanelProps): React.ReactElement {
	const timeline = useAgentActivityTimeline(taskId, summary, teamProgress);
	const { changes } = useRuntimeWorkspaceChanges(
		taskId,
		workspaceId,
		baseRef,
		"working_copy",
		stateVersion,
		1500,
		"watch",
	);

	const state = summary?.state ?? "idle";
	const model = summary?.modelId ?? "—";
	const currentTool = summary?.latestHookActivity?.toolName ?? null;
	const files = changes?.files ?? [];

	return (
		<div className="flex h-full flex-col gap-3 overflow-y-auto bg-surface-0 p-3 text-text-primary">
			<header className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-md border border-border bg-surface-1 px-3 py-2 text-xs">
				<span className="flex items-center gap-1.5 font-medium">
					<Activity size={14} className={cn(state === "running" ? "text-status-green" : "text-text-secondary")} />
					Watching agent
				</span>
				<span className="text-text-secondary">
					state: <span className="text-text-primary">{state}</span>
				</span>
				<span className="text-text-secondary">
					model: <span className="text-text-primary">{model}</span>
				</span>
				<span className="text-text-secondary">
					elapsed: <span className="text-text-primary">{formatElapsed(summary?.startedAt ?? null)}</span>
				</span>
				{currentTool ? (
					<span className="flex items-center gap-1 text-text-secondary">
						<Wrench size={12} /> <span className="text-text-primary">{currentTool}</span>
					</span>
				) : null}
				{onOpenTerminal ? (
					<button
						type="button"
						onClick={onOpenTerminal}
						className="ml-auto flex items-center gap-1 rounded-sm border border-border px-2 py-0.5 text-text-secondary hover:bg-surface-3"
					>
						<TerminalIcon size={12} /> Open terminal
					</button>
				) : null}
			</header>

			<section className="flex flex-1 flex-col gap-1">
				<h3 className="text-xs font-semibold uppercase tracking-wide text-text-tertiary">Activity</h3>
				<ol className="flex flex-col gap-1">
					{timeline.length === 0 ? (
						<li className="px-1 py-2 text-xs text-text-tertiary">
							No activity yet. Start the agent to watch it work.
						</li>
					) : (
						[...timeline].reverse().map((entry) => (
							<li key={entry.id} className="flex items-start gap-2 rounded-sm bg-surface-1 px-2 py-1.5 text-xs">
								<span className="mt-0.5 shrink-0 text-text-tertiary tabular-nums">{formatClock(entry.at)}</span>
								<span className="shrink-0">
									{entry.kind === "tool" ? (
										<Wrench size={12} className="text-status-blue" />
									) : entry.kind === "progress" ? (
										<Activity size={12} className="text-status-purple" />
									) : (
										<Activity size={12} className="text-text-secondary" />
									)}
								</span>
								<span className="min-w-0 break-words">
									{entry.toolName ? (
										<span className="font-medium text-status-blue">{entry.toolName}: </span>
									) : null}
									{entry.text}
								</span>
							</li>
						))
					)}
				</ol>
			</section>

			<section className="flex flex-col gap-1">
				<h3 className="text-xs font-semibold uppercase tracking-wide text-text-tertiary">
					Files changed this run ({files.length})
				</h3>
				{files.length === 0 ? (
					<p className="px-1 py-1 text-xs text-text-tertiary">No file changes captured yet.</p>
				) : (
					<ul className="flex flex-col gap-0.5">
						{files.map((file) => (
							<li
								key={file.path}
								className="flex items-center gap-2 rounded-sm px-2 py-1 text-xs hover:bg-surface-1"
							>
								{FILE_STATUS_ICON[file.status] ?? <FilePen size={13} className="text-text-secondary" />}
								<span className="min-w-0 flex-1 truncate font-mono">{file.path}</span>
								<span className="shrink-0 tabular-nums text-status-green">+{file.additions}</span>
								<span className="shrink-0 tabular-nums text-status-red">−{file.deletions}</span>
							</li>
						))}
					</ul>
				)}
			</section>
		</div>
	);
}

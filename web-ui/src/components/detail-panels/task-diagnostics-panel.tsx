import { Activity, RefreshCw } from "lucide-react";
import type React from "react";
import { useCallback, useEffect, useState } from "react";
import { formatDiagnosticTime } from "@/components/detail-panels/task-activity-model";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { Spinner } from "@/components/ui/spinner";
import { fetchTaskDiagnostics } from "@/runtime/runtime-config-query";
import type { RuntimeTaskDiagnosticEvent } from "@/runtime/types";

/**
 * The card detail view's collapsible local-telemetry diagnostics panel, extracted from the oversized
 * `card-detail-view.tsx` (todo §5.U). Lazily fetches the task's recent self-observation diagnostic events when
 * expanded, with manual refresh + loading/error states. Self-contained: drives only `{ workspaceId, taskId }`.
 */

function getDiagnosticSeverityClassName(severity: RuntimeTaskDiagnosticEvent["severity"]): string {
	if (severity === "error") {
		return "text-status-red";
	}
	if (severity === "warning") {
		return "text-status-orange";
	}
	return "text-text-secondary";
}

export function TaskDiagnosticsPanel({
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

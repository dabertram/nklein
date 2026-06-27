import { History, RefreshCw } from "lucide-react";
import type React from "react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { Spinner } from "@/components/ui/spinner";
import { fetchTaskEscalation } from "@/runtime/runtime-config-query";

/**
 * The card detail view's §5.AG "what was tried" escalation panel — the chronological attempt chain (rung × model ×
 * approach × outcome) from the Agent Attempt Ledger, so when a card escalates the operator sees an actionable report
 * instead of a silent dead end. Lazily fetches via `runtime.getTaskEscalation` when expanded; self-contained on
 * `{ workspaceId, taskId }`, mirroring the diagnostics panel.
 */

type EscalationReport = Awaited<ReturnType<typeof fetchTaskEscalation>>;

function getOutcomeClassName(outcome: string): string {
	if (outcome === "success") {
		return "text-status-green";
	}
	if (outcome === "timeout" || outcome === "loop") {
		return "text-status-red";
	}
	return "text-status-orange";
}

export function TaskEscalationPanel({
	workspaceId,
	taskId,
}: {
	workspaceId: string | null;
	taskId: string;
}): React.ReactElement {
	const [open, setOpen] = useState(false);
	const [isLoading, setIsLoading] = useState(false);
	const [report, setReport] = useState<EscalationReport | null>(null);
	const [error, setError] = useState<string | null>(null);

	const refreshEscalation = useCallback(() => {
		if (!workspaceId) {
			setReport(null);
			return;
		}
		setIsLoading(true);
		setError(null);
		void fetchTaskEscalation(workspaceId, taskId)
			.then((result) => {
				setReport(result);
			})
			.catch((refreshError) => {
				setError(refreshError instanceof Error ? refreshError.message : String(refreshError));
			})
			.finally(() => {
				setIsLoading(false);
			});
	}, [taskId, workspaceId]);

	useEffect(() => {
		setReport(null);
		setError(null);
		if (open) {
			refreshEscalation();
		}
	}, [open, refreshEscalation]);

	const summaryLabel = error
		? "Issue"
		: open && report
			? report.totalAttempts === 0
				? "No escalation"
				: `${report.totalAttempts} attempts · ${report.modelsTried.length} models`
			: "What was tried before escalating";

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
					<History size={14} className="shrink-0 text-text-secondary" />
					<span>What was tried</span>
					<span className="truncate text-text-tertiary">{summaryLabel}</span>
				</button>
				<Button
					size="sm"
					variant="ghost"
					icon={isLoading ? <Spinner size={14} /> : <RefreshCw size={14} />}
					disabled={!open || isLoading || !workspaceId}
					onClick={refreshEscalation}
				>
					Refresh
				</Button>
			</div>
			{open ? (
				<div className="mt-2 max-h-36 overflow-auto rounded-md border border-border bg-surface-0 p-2 text-[11px]">
					{error ? <div className="text-status-red">{error}</div> : null}
					{!error && isLoading ? <div className="text-text-secondary">Loading attempt history...</div> : null}
					{!error && !isLoading && report && report.totalAttempts === 0 ? (
						<div className="text-text-secondary">No retries — this card has not escalated.</div>
					) : null}
					{!error && !isLoading && report
						? report.attempts.map((row) => (
								<div
									key={`${row.rung}-${row.recordedAt}`}
									className="flex min-w-0 items-center gap-2 border-b border-border/60 py-1 last:border-b-0"
								>
									<span className="font-mono text-text-tertiary">#{row.rung}</span>
									<span className="truncate font-mono text-text-secondary">{row.modelId}</span>
									<span className="truncate text-text-tertiary">{row.approach}</span>
									<span className={cn("ml-auto shrink-0 font-mono", getOutcomeClassName(row.outcome))}>
										{row.outcome}
									</span>
								</div>
							))
						: null}
				</div>
			) : null}
		</div>
	);
}

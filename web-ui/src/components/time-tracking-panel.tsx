import { useEffect, useState } from "react";
import { fetchTimeTracking } from "@/runtime/queries/config";
import type { RuntimeTimeTrackingMetrics, RuntimeTimeTrackingResponse } from "@/runtime/types";

/**
 * F1.40 — per-project and per-card TIME tracking. Shows, for the whole project and each card: total age, active time
 * (!Klein actually working), and LLM processing time (total + successful). Read-only projection of the attempt ledger.
 */

function formatDuration(ms: number): string {
	if (ms <= 0) {
		return "—";
	}
	const seconds = Math.round(ms / 1000);
	if (seconds < 60) {
		return `${seconds}s`;
	}
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) {
		return `${minutes}m ${seconds % 60}s`;
	}
	const hours = Math.floor(minutes / 60);
	if (hours < 24) {
		return `${hours}h ${minutes % 60}m`;
	}
	return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

function MetricCells({ metrics }: { metrics: RuntimeTimeTrackingMetrics }): React.JSX.Element {
	return (
		<>
			<td className="px-3 py-1.5 text-right tabular-nums">{formatDuration(metrics.ageTotalMs)}</td>
			<td className="px-3 py-1.5 text-right tabular-nums">{formatDuration(metrics.activeMs)}</td>
			<td className="px-3 py-1.5 text-right tabular-nums">{formatDuration(metrics.llmTotalMs)}</td>
			<td className="px-3 py-1.5 text-right tabular-nums">{formatDuration(metrics.llmSuccessfulMs)}</td>
		</>
	);
}

export function TimeTrackingPanel({ workspaceId }: { workspaceId: string | null }): React.JSX.Element {
	const [data, setData] = useState<RuntimeTimeTrackingResponse | null>(null);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		let cancelled = false;
		void (async () => {
			try {
				const result = await fetchTimeTracking(workspaceId);
				if (!cancelled) {
					setData(result);
					setError(null);
				}
			} catch (caught) {
				if (!cancelled) {
					setError(caught instanceof Error ? caught.message : "Failed to load time tracking");
				}
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [workspaceId]);

	if (error) {
		return (
			<div className="rounded-md border border-status-red/50 bg-status-red/10 px-3 py-2 text-[12.5px] text-status-red">
				Time tracking: {error}
			</div>
		);
	}
	if (!data) {
		return (
			<div className="rounded-md border border-border bg-surface-2 px-3 py-2 text-[12.5px] text-text-secondary">
				Loading time tracking…
			</div>
		);
	}

	// Cards with any measured time first, longest LLM-time on top; then untouched cards.
	const sortedCards = [...data.cards].sort((a, b) => b.metrics.llmTotalMs - a.metrics.llmTotalMs);

	return (
		<div className="rounded-md border border-border bg-surface-1 p-3" data-testid="time-tracking-panel">
			<div className="mb-2 flex items-center justify-between gap-3">
				<h6 className="m-0 text-[12px] font-semibold uppercase tracking-wider text-text-secondary">
					Time tracking
				</h6>
				<span className="text-[11px] text-text-tertiary">age · active · LLM total · LLM ok</span>
			</div>
			<div className="overflow-x-auto rounded-md border border-border">
				<table className="w-full min-w-[520px] border-collapse text-left text-[12px]">
					<thead>
						<tr className="bg-surface-2 text-text-secondary">
							<th className="px-3 py-1.5 font-medium">Scope</th>
							<th className="px-3 py-1.5 text-right font-medium">Age</th>
							<th className="px-3 py-1.5 text-right font-medium">Active</th>
							<th className="px-3 py-1.5 text-right font-medium">LLM total</th>
							<th className="px-3 py-1.5 text-right font-medium">LLM ok</th>
						</tr>
					</thead>
					<tbody>
						<tr
							className="border-t border-border bg-surface-2/50 font-medium text-text-primary"
							data-testid="tt-project-row"
						>
							<td className="px-3 py-1.5">Project ({data.cards.length} cards)</td>
							<MetricCells metrics={data.project} />
						</tr>
						{sortedCards.map((card) => (
							<tr key={card.taskId} className="border-t border-border text-text-primary">
								<td className="max-w-[220px] truncate px-3 py-1.5" title={card.title}>
									{card.title}
								</td>
								<MetricCells metrics={card.metrics} />
							</tr>
						))}
					</tbody>
				</table>
			</div>
		</div>
	);
}

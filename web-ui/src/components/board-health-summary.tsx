// §5.AG board-health summary — a compact, glanceable "healthy / stuck / risky / done" rollup + a risk-inbox count
// for a workspace board, so the operator can see board health without scanning columns. Presentational: it derives
// everything from the workspace state via the shared `summarizeWorkspaceBoardHealth` (the same logic behind the
// `nklein task health` CLI), so the CLI and UI tell the same story. Zero-count states are hidden to stay compact;
// renders nothing when there is no board / no cards.
import type { RuntimeTaskSessionSummary } from "@runtime-contract";
import {
	type BoardHealthBoardView,
	type OperatorSignalOverrides,
	summarizeBoardHealth,
} from "@runtime-operator-board-health";
import { AlertTriangle, CheckCircle2, CircleDot, Inbox, PauseCircle } from "lucide-react";
import type { ReactNode } from "react";

interface BoardHealthSummaryProps {
	board: BoardHealthBoardView | null;
	taskSessions: Record<string, RuntimeTaskSessionSummary>;
	/**
	 * Supplies the off-summary signals (§5.L gate / §5.M ack / §5.S clarify / §5.A block) the board state doesn't carry,
	 * so `risky` + the inbox count can surface. Omitted today (those flags aren't threaded yet) → board state alone shows
	 * healthy/stuck/done; wire this when the gate/clarify subsystems expose per-task state.
	 */
	resolveOverrides?: (taskId: string) => OperatorSignalOverrides;
}

interface HealthItem {
	key: string;
	count: number;
	label: string;
	className: string;
	icon: ReactNode;
}

export function BoardHealthSummary({ board, taskSessions, resolveOverrides }: BoardHealthSummaryProps) {
	if (!board) {
		return null;
	}
	const health = summarizeBoardHealth(board, taskSessions, resolveOverrides);
	if (health.total === 0) {
		return null;
	}
	const items: HealthItem[] = [
		{
			key: "risky",
			count: health.counts.risky,
			label: "risky",
			className: "text-status-red",
			icon: <AlertTriangle size={12} />,
		},
		{
			key: "stuck",
			count: health.counts.stuck,
			label: "stuck",
			className: "text-status-orange",
			icon: <PauseCircle size={12} />,
		},
		{
			key: "healthy",
			count: health.counts.healthy,
			label: "healthy",
			className: "text-status-green",
			icon: <CircleDot size={12} />,
		},
		{
			key: "done",
			count: health.counts.done,
			label: "done",
			className: "text-text-secondary",
			icon: <CheckCircle2 size={12} />,
		},
	].filter((item) => item.count > 0);

	return (
		<div className="flex items-center gap-2 text-[11px]" role="group" aria-label="Board health">
			{items.map((item) => (
				<span
					key={item.key}
					className={`flex items-center gap-1 ${item.className}`}
					title={`${item.count} ${item.label}`}
				>
					{item.icon}
					<span className="font-medium tabular-nums">{item.count}</span>
				</span>
			))}
			{health.inbox.total > 0 ? (
				<span
					className="flex items-center gap-1 text-status-gold"
					title={`${health.inbox.total} card(s) need your input`}
				>
					<Inbox size={12} />
					<span className="font-medium tabular-nums">{health.inbox.total}</span>
				</span>
			) : null}
		</div>
	);
}

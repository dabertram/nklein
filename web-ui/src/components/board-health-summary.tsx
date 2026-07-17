// §5.AG board-health summary — a compact, glanceable "healthy / stuck / risky / done" rollup + the F12.52 "Needs you"
// queue for a workspace board, so the operator can see board health without scanning columns. Presentational: it
// derives everything from the workspace state via the shared `summarizeWorkspaceBoardHealth` (the same logic behind
// the `nklein task health` CLI), so the CLI and UI tell the same story. Zero-count states are hidden to stay compact;
// renders nothing when there is no board / no cards. The inbox chip opens the prioritized queue (most urgent decision
// first, one entry per task) — click an entry to jump to its card; this is the only tier that should ever interrupt.
import type { RuntimeTaskSessionSummary } from "@runtime-contract";
import {
	type BoardHealthBoardView,
	buildNeedsYouQueue,
	type OperatorSignalOverrides,
	summarizeBoardHealth,
} from "@runtime-operator-board-health";
import { AlertTriangle, CheckCircle2, CircleDot, Inbox, PauseCircle } from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";

interface BoardHealthSummaryProps {
	board: BoardHealthBoardView | null;
	taskSessions: Record<string, RuntimeTaskSessionSummary>;
	/**
	 * Supplies the off-summary signals (§5.L gate / §5.M ack / §5.S clarify / §5.A block) the board state doesn't carry,
	 * so `risky` + the inbox count can surface. Omitted today (those flags aren't threaded yet) → board state alone shows
	 * healthy/stuck/done; wire this when the gate/clarify subsystems expose per-task state.
	 */
	resolveOverrides?: (taskId: string) => OperatorSignalOverrides;
	/** F12.52: card titles for the queue entries (falls back to the task id). */
	titleByTaskId?: ReadonlyMap<string, string>;
	/** F12.52: jump to a card from the queue. Omitted → the chip stays a passive count. */
	onSelectTask?: (taskId: string) => void;
}

interface HealthItem {
	key: string;
	count: number;
	label: string;
	className: string;
	icon: ReactNode;
}

export function BoardHealthSummary({
	board,
	taskSessions,
	resolveOverrides,
	titleByTaskId,
	onSelectTask,
}: BoardHealthSummaryProps) {
	const [queueOpen, setQueueOpen] = useState(false);
	const rootRef = useRef<HTMLDivElement | null>(null);

	// Close the queue popover on any outside click (standard dismiss affordance).
	useEffect(() => {
		if (!queueOpen) {
			return;
		}
		const onPointerDown = (event: PointerEvent) => {
			if (rootRef.current && event.target instanceof Node && !rootRef.current.contains(event.target)) {
				setQueueOpen(false);
			}
		};
		document.addEventListener("pointerdown", onPointerDown);
		return () => document.removeEventListener("pointerdown", onPointerDown);
	}, [queueOpen]);

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
	const queue = buildNeedsYouQueue(health.inbox);

	return (
		<div
			ref={rootRef}
			className="relative flex items-center gap-2 text-[11px]"
			role="group"
			aria-label="Board health"
		>
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
				<button
					type="button"
					data-testid="needs-you-chip"
					className="flex cursor-pointer items-center gap-1 rounded-md border border-status-gold/40 bg-status-gold/10 px-1.5 py-0.5 text-status-gold hover:bg-status-gold/20"
					title={`${health.inbox.total} card(s) need your input — click for the queue`}
					onClick={() => setQueueOpen((open) => !open)}
				>
					<Inbox size={12} />
					<span className="font-medium tabular-nums">{health.inbox.total}</span>
					<span>Needs you</span>
				</button>
			) : null}
			{queueOpen && queue.length > 0 ? (
				<div
					data-testid="needs-you-queue"
					className="absolute top-full right-0 z-50 mt-1 w-72 rounded-lg border border-border bg-surface-0 p-1 shadow-lg"
				>
					<p className="m-0 px-2 py-1 text-[10px] uppercase tracking-wide text-text-tertiary">
						What needs you next
					</p>
					{queue.map((entry) => (
						<button
							key={entry.taskId}
							type="button"
							className="flex w-full cursor-pointer flex-col items-start gap-0.5 rounded-md px-2 py-1.5 text-left hover:bg-surface-1"
							onClick={() => {
								setQueueOpen(false);
								onSelectTask?.(entry.taskId);
							}}
						>
							<span className="w-full truncate text-[12px] text-text-primary">
								{titleByTaskId?.get(entry.taskId) ?? entry.taskId}
							</span>
							<span className="text-[11px] text-status-gold">{entry.action}</span>
						</button>
					))}
				</div>
			) : null}
		</div>
	);
}

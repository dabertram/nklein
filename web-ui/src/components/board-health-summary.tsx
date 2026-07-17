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
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

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
	const chipRef = useRef<HTMLButtonElement | null>(null);
	const portalRef = useRef<HTMLDivElement | null>(null);
	// The popover is PORTALED to <body> with a fixed anchor: the header strip scrolls horizontally
	// (overflow-x-auto), which would clip an absolutely-positioned child to a sliver.
	const [queueAnchor, setQueueAnchor] = useState<{ top: number; left: number } | null>(null);

	// Close on outside click; on scroll/resize RE-ANCHOR instead of closing — clicking the chip can itself
	// scroll the overflow strip (focus scroll-into-view), and closing on that made the popover un-openable.
	useEffect(() => {
		if (!queueOpen) {
			return;
		}
		const onPointerDown = (event: PointerEvent) => {
			if (!(event.target instanceof Node)) {
				return;
			}
			if (rootRef.current?.contains(event.target) || portalRef.current?.contains(event.target)) {
				return;
			}
			setQueueOpen(false);
		};
		const onMove = () => {
			const rect = chipRef.current?.getBoundingClientRect();
			if (!rect || rect.width === 0) {
				setQueueOpen(false);
				return;
			}
			const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
			setQueueAnchor({
				top: rect.bottom + 4,
				left: Math.max(8, viewportWidth > 0 ? Math.min(rect.right - 288, viewportWidth - 296) : rect.right - 288),
			});
		};
		document.addEventListener("pointerdown", onPointerDown);
		window.addEventListener("resize", onMove);
		// Capture phase catches the header strip's own horizontal scroll, not just the window.
		window.addEventListener("scroll", onMove, true);
		return () => {
			document.removeEventListener("pointerdown", onPointerDown);
			window.removeEventListener("resize", onMove);
			window.removeEventListener("scroll", onMove, true);
		};
	}, [queueOpen]);

	// Anchor is measured AFTER the open-render PAINTS (rAF), never inside the state updater — pre-paint
	// measurement returned a mid-layout rect in embedded webviews and froze the popover at the clamp floor.
	useLayoutEffect(() => {
		if (!queueOpen) {
			return;
		}
		const measure = () => {
			const rect = chipRef.current?.getBoundingClientRect();
			// Some embedded webviews report window.innerWidth as 0 while element rects stay real — only
			// clamp to the viewport when the viewport actually measures.
			const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
			setQueueAnchor(
				rect && rect.width > 0
					? {
							top: rect.bottom + 4,
							left: Math.max(
								8,
								viewportWidth > 0 ? Math.min(rect.right - 288, viewportWidth - 296) : rect.right - 288,
							),
						}
					: null,
			);
		};
		measure();
		const frame = requestAnimationFrame(measure);
		return () => cancelAnimationFrame(frame);
	}, [queueOpen]);

	const toggleQueue = () => setQueueOpen((open) => !open);

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
					ref={chipRef}
					type="button"
					data-testid="needs-you-chip"
					className="flex cursor-pointer items-center gap-1 rounded-md border border-status-gold/40 bg-status-gold/10 px-1.5 py-0.5 text-status-gold hover:bg-status-gold/20"
					title={`${health.inbox.total} card(s) need your input — click for the queue`}
					onClick={toggleQueue}
				>
					<Inbox size={12} />
					<span className="font-medium tabular-nums">{health.inbox.total}</span>
					<span>Needs you</span>
				</button>
			) : null}
			{queueOpen && queue.length > 0 && queueAnchor
				? createPortal(
						<div
							ref={portalRef}
							data-testid="needs-you-queue"
							className="fixed z-50 w-72 rounded-lg border border-border bg-surface-0 p-1 shadow-lg"
							style={{ top: queueAnchor.top, left: queueAnchor.left }}
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
						</div>,
						document.body,
					)
				: null}
		</div>
	);
}

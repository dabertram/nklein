import type React from "react";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { cn } from "@/components/ui/cn";
import { getRuntimeTrpcClient } from "@/runtime/trpc-client";
import type { RuntimeChatBoardStream } from "@/runtime/types";
import { useTrpcQuery } from "@/runtime/use-trpc-query";

/**
 * §5.AU stream-overview surface — a compact list of the owning project's streams (epics), each with its health badge,
 * progress (done/total), and running count. Self-fetches the server-side rollup (`chat.getBoardStreams`) while `enabled`
 * (the board-independent chat client can't roll streams up itself), refreshing every few seconds so it tracks live card
 * progress. Renders nothing when there are no streams, so a board without epics shows no panel.
 */

const HEALTH_STYLE: Record<RuntimeChatBoardStream["health"], { label: string; cls: string }> = {
	on_track: { label: "on track", cls: "text-status-green border-status-green/40" },
	stale: { label: "stale", cls: "text-text-tertiary border-border" },
	at_risk: { label: "at risk", cls: "text-status-orange border-status-orange/40" },
	blocked: { label: "blocked", cls: "text-status-red border-status-red/40" },
	done: { label: "done", cls: "text-status-blue border-status-blue/40" },
	empty: { label: "empty", cls: "text-text-tertiary border-border" },
};

const REFRESH_MS = 5000;

export function StreamOverviewPanel({
	enabled,
	onSelectStream,
}: {
	enabled: boolean;
	/** Address the chat to a stream (inserts its `@stream:<id>` handle into the composer). Absent ⇒ rows are non-clickable. */
	onSelectStream?: (streamId: string) => void;
}): React.ReactElement | null {
	const client = useMemo(() => getRuntimeTrpcClient(null), []);
	// Stable queryFn: `useTrpcQuery`'s fetch effect keys on the queryFn identity, so a fresh inline function every render
	// would re-fire the effect each render (a refetch loop). Memoized on the (stable) client.
	const queryFn = useCallback(async () => await client.chat.getBoardStreams.query(), [client]);
	const query = useTrpcQuery({ enabled, queryFn, retainDataOnError: true });

	// Keep the overview fresh as cards progress — a light poll while the panel is enabled (mirrors the transcript poll).
	// Ref-stable so the interval re-arms only on enable/disable, not on every render.
	const refetchRef = useRef(query.refetch);
	refetchRef.current = query.refetch;
	useEffect(() => {
		if (!enabled) {
			return;
		}
		const interval = setInterval(() => {
			void refetchRef.current();
		}, REFRESH_MS);
		return () => clearInterval(interval);
	}, [enabled]);

	const data = query.data;
	if (!enabled || !data || data.streams.length === 0) {
		return null;
	}
	return (
		<div
			data-testid="chat-stream-overview"
			className="flex max-h-40 shrink-0 flex-col gap-1 overflow-y-auto border-t border-border bg-surface-1 px-3 py-2"
		>
			<div className="select-none text-[10.5px] uppercase tracking-wide text-text-tertiary">Streams</div>
			{data.streams.map((stream) => {
				const style = HEALTH_STYLE[stream.health];
				return (
					<button
						type="button"
						key={stream.id}
						data-testid={`chat-stream-row-${stream.id}`}
						onClick={onSelectStream ? () => onSelectStream(stream.id) : undefined}
						disabled={!onSelectStream}
						title={onSelectStream ? `Address the chat to "${stream.title}"` : undefined}
						className={cn(
							"flex min-w-0 items-center gap-2 rounded px-1 text-left text-[11.5px]",
							onSelectStream ? "cursor-pointer hover:bg-surface-2" : "cursor-default",
						)}
					>
						<span className={cn("shrink-0 rounded border px-1 py-0.5 text-[10px]", style.cls)}>
							{style.label}
						</span>
						<span className="truncate font-medium text-text-primary">{stream.title}</span>
						<span className="ml-auto shrink-0 text-text-tertiary">
							{stream.done}/{stream.total}
							{stream.running > 0 ? ` · ${stream.running} running` : ""}
						</span>
					</button>
				);
			})}
			{data.ungroupedCardCount > 0 ? (
				<div className="select-none text-[10.5px] text-text-tertiary">
					+{data.ungroupedCardCount} card(s) not in a stream
				</div>
			) : null}
		</div>
	);
}

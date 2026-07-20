import type React from "react";
import { useEffect, useState } from "react";
import { cn } from "@/components/ui/cn";
import { fetchCardTimeline } from "@/runtime/queries/task-control";
import type { RuntimeCardTimelineResponse } from "@/runtime/types";

/**
 * N18 — the card's FORENSIC timeline, as a product surface.
 *
 * David, 2026-07-20: *"i want that timeline to be inherent part of !Klein and not just a debug tool … a full
 * picture of any activity, state change/transition, attempted activity, and all the results."*
 *
 * Distinct from the Action Trail panel next to it, deliberately. That one is the plain-language story of what
 * the agent DID, for someone deciding whether a card is good. This is every source merged verbatim, in true
 * chronological order, for someone working out what WENT WRONG. Adjacency carries the answer here — the decisive
 * fact in the s03 investigation was that a bounce and a capture failure were six lines apart — so events are
 * never grouped or reordered by kind.
 *
 * ── SOURCE AVAILABILITY IS RENDERED, NOT HIDDEN ──
 * "This source had no events" and "this source could not be read" are different facts, and only one of them
 * means the timeline is trustworthy. A panel that collapses them shows a deleted log as a quiet card, which is
 * worse than showing nothing — the reader draws a confident wrong conclusion instead of going to look.
 */

const SOURCE_META: Record<string, { label: string; className: string }> = {
	observation: { label: "telemetry", className: "text-status-blue" },
	ledger: { label: "ledger", className: "text-status-green" },
	board: { label: "board", className: "text-text-tertiary" },
	workflow: { label: "workflow", className: "text-text-tertiary" },
	log: { label: "log", className: "text-text-tertiary" },
};

function formatEventTime(at: number): string {
	if (!Number.isFinite(at) || at <= 0) {
		// Synthetic ordinals are used for sources with no real clock. Showing a fake time would silently claim
		// precision the record does not have.
		return "—";
	}
	return new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function CardTimelinePanel({
	workspaceId,
	taskId,
}: {
	workspaceId: string | null;
	taskId: string;
}): React.ReactElement | null {
	const [open, setOpen] = useState(false);
	const [timeline, setTimeline] = useState<RuntimeCardTimelineResponse | null>(null);
	const [loadFailed, setLoadFailed] = useState(false);

	useEffect(() => {
		if (!open || workspaceId === null) {
			return;
		}
		let cancelled = false;
		void fetchCardTimeline(workspaceId, taskId)
			.then((response) => {
				if (!cancelled) {
					setTimeline(response);
				}
			})
			.catch(() => {
				if (!cancelled) {
					// An unreachable endpoint must never read as "nothing happened to this card".
					setLoadFailed(true);
					setTimeline(null);
				}
			});
		return () => {
			cancelled = true;
		};
	}, [open, workspaceId, taskId]);

	const unreadableSources = timeline?.sourcesRead.filter((source) => !source.available) ?? [];

	return (
		<section className="border-border-subtle border-t pt-2">
			<button
				type="button"
				onClick={() => setOpen((value) => !value)}
				className="flex w-full items-center justify-between text-left text-text-secondary text-xs hover:text-text-primary"
			>
				<span>Timeline — everything that happened to this card</span>
				<span aria-hidden>{open ? "−" : "+"}</span>
			</button>

			{open && (
				<div className="mt-2 space-y-2">
					{loadFailed && (
						<p className="text-status-red text-xs">
							The timeline could not be loaded. This is a load failure, not an empty card — nothing here says the
							card was idle.
						</p>
					)}

					{timeline && (
						<>
							{timeline.partial && unreadableSources.length > 0 && (
								<p className="text-status-amber text-xs">
									PARTIAL: {unreadableSources.map((source) => source.source).join(", ")} could not be read, so
									events from {unreadableSources.length === 1 ? "it" : "them"} are missing. A gap below may be
									this, not silence.
								</p>
							)}

							{timeline.totalEvents > timeline.events.length && (
								<p className="text-text-tertiary text-xs">
									Showing the most recent {timeline.events.length} of {timeline.totalEvents} events.
								</p>
							)}

							{timeline.events.length === 0 ? (
								<p className="text-text-tertiary text-xs">
									No events recorded for this card yet
									{timeline.partial
										? " — and at least one source was unreadable, so this may be incomplete."
										: "."}
								</p>
							) : (
								<ol className="space-y-1">
									{timeline.events.map((event, index) => {
										const meta = SOURCE_META[event.source] ?? {
											label: event.source,
											className: "text-text-tertiary",
										};
										return (
											<li
												// Events carry no id and duplicates are legitimate (the same kind can repeat within a
												// millisecond), so the index is the only stable key available here.
												key={`${event.at}-${event.kind}-${index}`}
												className="flex gap-2 font-mono text-[11px] leading-relaxed"
											>
												<span className="shrink-0 text-text-tertiary">{formatEventTime(event.at)}</span>
												<span className={cn("w-16 shrink-0", meta.className)}>{meta.label}</span>
												<span className="shrink-0 text-text-secondary">{event.kind}</span>
												<span className="min-w-0 break-words text-text-primary">{event.detail}</span>
											</li>
										);
									})}
								</ol>
							)}

							<p className="text-text-tertiary text-[11px]">
								{timeline.sourcesRead
									.map(
										(source) =>
											`${source.source}: ${source.available ? `${source.eventCount}` : "unreadable"}`,
									)
									.join(" · ")}
							</p>
						</>
					)}
				</div>
			)}
		</section>
	);
}

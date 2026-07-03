// §5.BB Zoom 1 — the LEAN board: a minimal Doing / Review / Done render of the SAME board data (no cockpit,
// no fleet, no card chrome), optionally filtered to one stream (clicking a cluster on the activity map lands
// here). Deliberately a simple projection — not a fork of the kanban board component tree.

import type { ReactElement } from "react";

import { UNPLANNED_CLUSTER_ID } from "@/components/activity-map-model";
import { cn } from "@/components/ui/cn";
import type { RuntimeTaskSessionSummary } from "@/runtime/types";
import type { BoardCard, BoardColumn } from "@/types";

const LEAN_LANES: readonly { key: string; label: string; columnIds: readonly string[] }[] = [
	{ key: "doing", label: "Doing", columnIds: ["in_progress"] },
	{ key: "review", label: "Review", columnIds: ["review"] },
	{ key: "done", label: "Done", columnIds: ["completed"] },
];

function matchesStream(card: BoardCard, streamFilter: string | null): boolean {
	if (!streamFilter) {
		return true;
	}
	const slug = card.generatedFromPlan?.planSlug?.trim() || UNPLANNED_CLUSTER_ID;
	return slug === streamFilter;
}

export function LeanBoardView({
	columns,
	sessions,
	streamFilter,
	onSelectCard,
	onBackToOverview,
}: {
	columns: readonly BoardColumn[];
	sessions: Readonly<Record<string, RuntimeTaskSessionSummary>>;
	/** Cluster id from the activity map, or null for the whole board. */
	streamFilter: string | null;
	onSelectCard: (cardId: string) => void;
	onBackToOverview: () => void;
}): ReactElement {
	return (
		<div className="flex flex-1 min-h-0 flex-col p-4" data-testid="lean-board">
			<div className="mb-3 flex items-center gap-2 text-xs text-text-tertiary">
				<button type="button" onClick={onBackToOverview} className="text-accent hover:underline">
					◉ Overview
				</button>
				<span>/</span>
				<span className="font-medium text-text-primary">
					{streamFilter ? streamFilter.replaceAll(/[-_]+/g, " ") : "whole board"}
				</span>
				<span>— lean view</span>
			</div>
			<div className="grid flex-1 min-h-0 grid-cols-3 gap-3 overflow-y-auto content-start">
				{LEAN_LANES.map((lane) => {
					const cards = columns
						.filter((column) => lane.columnIds.includes(column.id))
						.flatMap((column) => column.cards)
						.filter((card) => matchesStream(card, streamFilter));
					return (
						<div
							key={lane.key}
							className="rounded-lg border border-border bg-surface-1 p-2.5"
							data-testid={`lean-lane-${lane.key}`}
						>
							<div className="flex items-center justify-between pb-2 text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">
								<span>{lane.label}</span>
								<span className="text-text-secondary">{cards.length}</span>
							</div>
							{cards.map((card) => {
								const session = sessions[card.id];
								const live = session?.state === "running";
								return (
									<button
										key={card.id}
										type="button"
										onClick={() => onSelectCard(card.id)}
										className={cn(
											"mb-2 w-full rounded-md border bg-surface-2 px-2.5 py-2 text-left text-[12.5px] font-medium text-text-primary hover:bg-surface-3",
											live ? "border-accent/45" : "border-border",
										)}
									>
										{card.title}
										{live ? (
											<span className="mt-1 block text-[10.5px] font-normal text-accent">
												{session?.modelId ?? "running"} ·{" "}
												{session?.latestHookActivity?.toolName ?? "active"}
											</span>
										) : null}
									</button>
								);
							})}
							{cards.length === 0 ? (
								<div className="py-3 text-center text-[11px] italic text-text-tertiary">empty</div>
							) : null}
						</div>
					);
				})}
			</div>
		</div>
	);
}

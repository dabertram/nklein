import type React from "react";
import { useEffect, useState } from "react";
import { fetchCardEffort } from "@/runtime/queries/task-control";
import type { RuntimeCardEffortResponse } from "@/runtime/types";

/**
 * F12.58 — the card's cost/effort meter: tokens + wall time this card has consumed across its runs, with the
 * board total for proportion. `untrackedRuns` keeps the number honest — runs without token telemetry mean the
 * real spend is HIGHER than shown. Collapsed by default; loads on open (read-only projection of the persisted
 * run summaries — no polling).
 */

function formatTokens(tokens: number): string {
	if (tokens >= 1_000_000) {
		return `${(tokens / 1_000_000).toFixed(1)}M`;
	}
	if (tokens >= 1_000) {
		return `${(tokens / 1_000).toFixed(1)}k`;
	}
	return `${tokens}`;
}

function formatWall(ms: number): string {
	return ms >= 3_600_000 ? `${(ms / 3_600_000).toFixed(1)}h` : `${(ms / 60_000).toFixed(1)}m`;
}

export function CardEffortPanel({
	workspaceId,
	taskId,
}: {
	workspaceId: string | null;
	taskId: string;
}): React.ReactElement | null {
	const [open, setOpen] = useState(false);
	const [effort, setEffort] = useState<RuntimeCardEffortResponse | null>(null);
	const [loadFailed, setLoadFailed] = useState(false);
	useEffect(() => {
		if (!open || workspaceId === null) {
			return;
		}
		let cancelled = false;
		void fetchCardEffort(workspaceId, taskId)
			.then((response) => {
				if (!cancelled) {
					setEffort(response);
				}
			})
			.catch(() => {
				if (!cancelled) {
					// Honest failure state: an unreachable endpoint must never read as "zero cost".
					setLoadFailed(true);
					setEffort(null);
				}
			});
		return () => {
			cancelled = true;
		};
	}, [open, taskId, workspaceId]);
	if (workspaceId === null) {
		return null;
	}
	return (
		<div className="rounded-md border border-border bg-surface-1 p-2">
			<button
				type="button"
				className="flex w-full cursor-pointer items-center justify-between text-left text-xs font-medium text-text-secondary hover:text-text-primary"
				onClick={() => setOpen((current) => !current)}
			>
				<span>Cost meter</span>
				<span className="text-text-tertiary">{open ? "▾" : "▸"}</span>
			</button>
			{open ? (
				loadFailed ? (
					<div className="pt-2 text-xs text-text-tertiary">
						Could not load effort (the runtime may predate this endpoint — restart it to enable).
					</div>
				) : effort === null ? (
					<div className="pt-2 text-xs text-text-tertiary">Loading…</div>
				) : effort.card === null ? (
					<div className="pt-2 text-xs text-text-tertiary">No recorded runs for this card yet.</div>
				) : (
					<div className="space-y-1 pt-2 text-xs text-text-secondary">
						<div>
							<span className="font-medium">{formatTokens(effort.card.totalTokens)}</span> tokens ·{" "}
							{formatWall(effort.card.wallMs)} across {effort.card.runs} run{effort.card.runs === 1 ? "" : "s"}
						</div>
						<div className="text-text-tertiary">
							{formatTokens(effort.card.promptTokens)} prompt · {formatTokens(effort.card.completionTokens)}{" "}
							completion
						</div>
						{effort.card.untrackedRuns > 0 ? (
							<div className="text-status-yellow">
								{effort.card.untrackedRuns} run{effort.card.untrackedRuns === 1 ? "" : "s"} without token
								telemetry — real spend is higher.
							</div>
						) : null}
						<div className="text-text-tertiary">
							Board total: {formatTokens(effort.boardTotalTokens)} tokens · {formatWall(effort.boardWallMs)}
						</div>
					</div>
				)
			) : null}
		</div>
	);
}

import type React from "react";
import { useEffect, useState } from "react";
import { cn } from "@/components/ui/cn";
import { fetchTaskActionTrail } from "@/runtime/queries/task-control";
import type { RuntimeTaskActionTrailEntry } from "@/runtime/types";

/**
 * F12.55 — the card's plain-language action trail: what the agent actually DID, chronologically, anchored to the
 * files it touched, with reversibility color-coding (an irreversible action reads red even in passing). The
 * agent's own stated intent renders as a "working hypothesis" — CoT is often post-hoc, so it is framed as the
 * agent's story about the change, never as evidence the change is correct. Collapsed by default; loads on open.
 */

const REVERSIBILITY_META: Record<RuntimeTaskActionTrailEntry["reversibility"], { label: string; className: string }> = {
	read_only: { label: "read", className: "text-text-tertiary" },
	reversible: { label: "revertable", className: "text-status-blue" },
	irreversible: { label: "IRREVERSIBLE", className: "text-status-red" },
};

function formatTrailTime(at: number | null): string {
	if (at === null) {
		return "—";
	}
	return new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function ActionTrailPanel({
	workspaceId,
	taskId,
}: {
	workspaceId: string | null;
	taskId: string;
}): React.ReactElement | null {
	const [open, setOpen] = useState(false);
	const [entries, setEntries] = useState<RuntimeTaskActionTrailEntry[] | null>(null);
	const [totalEntries, setTotalEntries] = useState(0);
	const [loadFailed, setLoadFailed] = useState(false);
	useEffect(() => {
		if (!open || workspaceId === null) {
			return;
		}
		let cancelled = false;
		void fetchTaskActionTrail(workspaceId, taskId)
			.then((response) => {
				if (!cancelled) {
					setEntries(response.entries);
					setTotalEntries(response.totalEntries);
				}
			})
			.catch(() => {
				if (!cancelled) {
					// Honest failure state: an unreachable endpoint must never read as "no activity".
					setLoadFailed(true);
					setEntries([]);
					setTotalEntries(0);
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
				<span>Action trail</span>
				<span className="text-text-tertiary">{open ? "▾" : "▸"}</span>
			</button>
			{open ? (
				entries === null ? (
					<p className="mt-2 text-xs text-text-tertiary">Loading the ledger…</p>
				) : loadFailed ? (
					<p className="mt-2 text-xs text-text-tertiary">
						Could not load the trail (the runtime may predate this endpoint — restart it to enable).
					</p>
				) : entries.length === 0 ? (
					<p className="mt-2 text-xs text-text-tertiary">
						No ledgered activity for this card yet — the trail fills as the agent works.
					</p>
				) : (
					<div className="mt-2 flex flex-col gap-1">
						{totalEntries > entries.length ? (
							<p className="text-[11px] text-text-tertiary">
								Showing the latest {entries.length} of {totalEntries} entries.
							</p>
						) : null}
						<ol className="flex flex-col gap-1">
							{entries.map((entry, index) => {
								const meta = REVERSIBILITY_META[entry.reversibility];
								return (
									<li
										key={`${entry.at ?? "t"}-${index}`}
										className="rounded-sm border border-border/60 bg-surface-2 px-2 py-1 text-xs"
									>
										<div className="flex items-baseline gap-2">
											<span className="shrink-0 tabular-nums text-[10px] text-text-tertiary">
												{formatTrailTime(entry.at)}
											</span>
											<span className="min-w-0 flex-1 text-text-primary">{entry.text}</span>
											<span className={cn("shrink-0 text-[10px] uppercase tracking-wide", meta.className)}>
												{meta.label}
											</span>
										</div>
										{entry.hypothesis ? (
											<p className="mt-0.5 pl-14 text-[11px] italic text-text-tertiary">
												working hypothesis: {entry.hypothesis}
											</p>
										) : null}
									</li>
								);
							})}
						</ol>
						<p className="text-[10px] text-text-tertiary">
							Hypotheses are the agent's own account of its intent — a story to check against the diff, not
							evidence the change is correct.
						</p>
					</div>
				)
			) : null}
		</div>
	);
}

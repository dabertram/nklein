import { Brain, Trash2 } from "lucide-react";
import type React from "react";
import { useCallback, useEffect, useState } from "react";
import { deleteSessionMemory, fetchSessionMemory, type SessionMemoryRecord } from "@/runtime/runtime-config-query";

/**
 * F2.9b — the session's unified MEMORY view: every recalled record with its provenance ("why recalled / where from")
 * and a typed delete control. Deletable records (the user's own chat memories, Basic-Memory notes) get a Forget
 * button; immutable projections (ledger/skills/plan) show WHY they can't be forgotten instead of a dead button.
 * Collapsible (fetch on open), mounted in the chat session header alongside the host-action audit panel.
 */

export function SessionMemoryPanel({ sessionId }: { sessionId: string }): React.ReactElement {
	const [open, setOpen] = useState(false);
	const [records, setRecords] = useState<SessionMemoryRecord[] | null>(null);
	const [loading, setLoading] = useState(false);
	const [busyId, setBusyId] = useState<string | null>(null);

	const refresh = useCallback(() => {
		setLoading(true);
		void fetchSessionMemory(sessionId)
			.then(setRecords)
			.catch(() => setRecords([]))
			.finally(() => setLoading(false));
	}, [sessionId]);

	useEffect(() => {
		if (open && records === null) {
			refresh();
		}
	}, [open, records, refresh]);

	const forget = useCallback(async (record: SessionMemoryRecord) => {
		if (record.deleteControl.kind === "none") {
			return;
		}
		setBusyId(record.id);
		try {
			await deleteSessionMemory(record.deleteControl);
			setRecords((current) => (current ? current.filter((entry) => entry.id !== record.id) : current));
		} catch {
			// Leave it in place; the next open re-syncs.
		} finally {
			setBusyId(null);
		}
	}, []);

	return (
		<div className="rounded-md border border-border bg-surface-2" data-testid="session-memory">
			<button
				type="button"
				data-testid="session-memory-toggle"
				onClick={() => setOpen((value) => !value)}
				className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[12px] text-text-secondary hover:text-text-primary"
			>
				<Brain size={13} className="shrink-0" />
				<span>Memory{records ? ` (${records.length})` : ""}</span>
				<span className="ml-auto text-[11px] text-text-tertiary">{open ? "Hide" : "Show"}</span>
			</button>
			{open ? (
				<div className="border-t border-border px-2.5 py-2" data-testid="session-memory-body">
					{loading && records === null ? (
						<p className="m-0 text-[12px] text-text-tertiary">Loading…</p>
					) : records && records.length > 0 ? (
						<ul className="m-0 flex list-none flex-col gap-1.5 p-0">
							{records.map((record) => (
								<li
									key={record.id}
									data-testid="session-memory-item"
									className="flex items-start gap-2 rounded border border-border bg-surface-0 p-1.5"
								>
									<div className="min-w-0 flex-1">
										<div className="break-words text-[12px] text-text-primary">{record.text}</div>
										<div className="mt-0.5 text-[10.5px] text-text-tertiary">
											<span className="uppercase tracking-wide">{record.source}</span> · {record.provenance}
										</div>
									</div>
									{record.deleteControl.kind !== "none" ? (
										<button
											type="button"
											data-testid="session-memory-forget"
											aria-label={`Forget: ${record.text.slice(0, 40)}`}
											disabled={busyId === record.id}
											onClick={() => void forget(record)}
											className="shrink-0 rounded p-1 text-text-tertiary hover:bg-surface-2 hover:text-status-red disabled:opacity-40"
										>
											<Trash2 size={12} />
										</button>
									) : (
										<span
											data-testid="session-memory-locked"
											title={record.deleteControl.reason}
											className="shrink-0 select-none text-[10px] text-text-tertiary"
										>
											kept
										</span>
									)}
								</li>
							))}
						</ul>
					) : (
						<p className="m-0 text-[12px] text-text-tertiary" data-testid="session-memory-empty">
							No memories for this session yet.
						</p>
					)}
				</div>
			) : null}
		</div>
	);
}

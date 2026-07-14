import { History } from "lucide-react";
import type React from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { cn } from "@/components/ui/cn";
import { NativeSelect } from "@/components/ui/native-select";
import { fetchChatHostActionAudit } from "@/runtime/runtime-config-query";

/**
 * F2.12b — the host-action audit history for a chat session: every gated host action (what, under which mode, the
 * policy decision, whether the user confirmed + whether it executed), newest first. Read-only and secret-safe (the
 * store masks secrets at write time). Collapsible + lazily fetched, mirroring the card-detail escalation panel.
 */

type AuditEntry = Awaited<ReturnType<typeof fetchChatHostActionAudit>>[number];

const DECISION_CLASS: Record<AuditEntry["decision"], string> = {
	allow: "text-status-green",
	confirm: "text-status-orange",
	deny: "text-status-red",
};

function formatTime(epochMs: number): string {
	return new Intl.DateTimeFormat(undefined, {
		month: "short",
		day: "numeric",
		hour: "2-digit",
		minute: "2-digit",
	}).format(new Date(epochMs));
}

export function ChatHostActionAuditPanel({ sessionId }: { sessionId: string }): React.ReactElement {
	const [open, setOpen] = useState(false);
	const [entries, setEntries] = useState<AuditEntry[] | null>(null);
	const [loading, setLoading] = useState(false);
	const [decisionFilter, setDecisionFilter] = useState<"all" | AuditEntry["decision"]>("all");
	const [executedOnly, setExecutedOnly] = useState(false);

	const refresh = useCallback(() => {
		setLoading(true);
		void fetchChatHostActionAudit(sessionId)
			.then(setEntries)
			.catch(() => setEntries([]))
			.finally(() => setLoading(false));
	}, [sessionId]);

	// Re-fetch when opened or when the session changes; collapse resets the cached list.
	useEffect(() => {
		setEntries(null);
		if (open) {
			refresh();
		}
	}, [open, refresh]);

	const filtered = useMemo(
		() =>
			(entries ?? []).filter(
				(entry) =>
					(decisionFilter === "all" || entry.decision === decisionFilter) && (!executedOnly || entry.executed),
			),
		[entries, decisionFilter, executedOnly],
	);

	return (
		<div className="rounded-md border border-border bg-surface-2" data-testid="chat-host-action-audit">
			<button
				type="button"
				data-testid="chat-host-action-audit-toggle"
				className="flex w-full cursor-pointer items-center gap-2 px-2 py-1 text-left text-[11px] font-medium text-text-secondary"
				onClick={() => setOpen((current) => !current)}
			>
				<History size={12} className="shrink-0" />
				<span>Host action history</span>
				{entries !== null ? <span className="text-text-tertiary">({entries.length})</span> : null}
			</button>
			{open ? (
				<div className="border-t border-border px-2 py-1.5 text-[11px]">
					<div className="mb-1.5 flex items-center gap-1.5 text-text-secondary">
						<NativeSelect
							size="sm"
							aria-label="Filter by decision"
							data-testid="chat-host-action-audit-decision-filter"
							value={decisionFilter}
							onChange={(event) => setDecisionFilter(event.target.value as typeof decisionFilter)}
						>
							<option value="all">any decision</option>
							<option value="allow">allowed</option>
							<option value="confirm">confirmed</option>
							<option value="deny">denied</option>
						</NativeSelect>
						<label className="flex items-center gap-1">
							<input
								type="checkbox"
								data-testid="chat-host-action-audit-executed-only"
								checked={executedOnly}
								onChange={(event) => setExecutedOnly(event.target.checked)}
							/>
							executed only
						</label>
					</div>
					{loading ? <div className="text-text-secondary">Loading…</div> : null}
					{!loading && filtered.length === 0 ? (
						<div className="text-text-tertiary">No host actions recorded for this chat.</div>
					) : null}
					{!loading
						? filtered.map((entry) => (
								<div
									key={entry.id}
									className="flex min-w-0 items-center gap-2 border-b border-border/60 py-1 last:border-b-0"
									title={entry.detail ?? undefined}
								>
									<span className="shrink-0 font-mono text-text-tertiary">{entry.action}</span>
									<span className={cn("shrink-0 font-mono", DECISION_CLASS[entry.decision])}>
										{entry.decision}
									</span>
									<span className="min-w-0 flex-1 truncate text-text-secondary">{entry.detail ?? "—"}</span>
									<span className="shrink-0 text-text-tertiary">{entry.executed ? "ran" : "not run"}</span>
									<span className="shrink-0 text-text-tertiary">{formatTime(entry.recordedAt)}</span>
								</div>
							))
						: null}
				</div>
			) : null}
		</div>
	);
}

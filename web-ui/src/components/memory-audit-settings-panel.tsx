// Settings UI for the F5.2 "Basic Memory audit" card (settings-dialog sections), sibling of the swarm-guardrails
// panel. Controlled: the parent owns the inputs value + onChange + dirty/save plumbing (state stays in the settings
// dialog for the unified save). Owns the four editable controls — enable, pause, cadence (days), staleness (days) —
// with per-field out-of-range flagging and a reset-to-defaults action. The audit is read-only (flags stale/orphaned/
// broken-link/duplicate notes, never deletes), so it's safe on by default.
import { areRuntimeMemoryFreshnessAuditEqual, DEFAULT_RUNTIME_MEMORY_FRESHNESS_AUDIT } from "@runtime-contract";
import { BookMarked } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import {
	inputsToMemoryAudit,
	isMemoryAuditInputOutOfRange,
	MEMORY_AUDIT_DAY_BOUNDS,
	type MemoryAuditInputs,
	memoryAuditToInputs,
} from "@/components/runtime-settings-memory-audit";
import { fetchMemoryAudit } from "@/runtime/runtime-config-query";
import type { RuntimeMemoryAuditResponse } from "@/runtime/types";

const cadenceInputId = "runtime-settings-memory-audit-cadence";
const stalenessInputId = "runtime-settings-memory-audit-staleness";

export interface MemoryAuditSettingsPanelProps {
	value: MemoryAuditInputs;
	onChange: (next: MemoryAuditInputs) => void;
	workspaceId: string | null;
	disabled?: boolean;
}

const auditStateLabel: Readonly<Record<RuntimeMemoryAuditResponse["state"], string>> = {
	disabled: "Disabled",
	paused: "Paused",
	never_run: "Waiting for the first idle audit",
	clean: "Last audit clean",
	findings: "Findings need review",
};

function formatAuditTime(value: number | null): string {
	return value === null ? "Not yet" : new Date(value).toLocaleString();
}

export function MemoryAuditSettingsPanel({
	value,
	onChange,
	workspaceId,
	disabled = false,
}: MemoryAuditSettingsPanelProps) {
	const [status, setStatus] = useState<RuntimeMemoryAuditResponse | null>(null);
	const [statusError, setStatusError] = useState<string | null>(null);
	const [statusLoading, setStatusLoading] = useState(false);
	const requestGeneration = useRef(0);
	const refreshStatus = useCallback(async () => {
		const generation = ++requestGeneration.current;
		setStatusLoading(true);
		setStatusError(null);
		try {
			const next = await fetchMemoryAudit(workspaceId);
			if (requestGeneration.current === generation) setStatus(next);
		} catch (cause) {
			if (requestGeneration.current === generation) {
				setStatusError(cause instanceof Error ? cause.message : String(cause));
			}
		} finally {
			if (requestGeneration.current === generation) setStatusLoading(false);
		}
	}, [workspaceId]);

	useEffect(() => {
		void refreshStatus();
		return () => {
			requestGeneration.current += 1;
		};
	}, [refreshStatus]);

	const isDefault = areRuntimeMemoryFreshnessAuditEqual(
		inputsToMemoryAudit(value),
		DEFAULT_RUNTIME_MEMORY_FRESHNESS_AUDIT,
	);
	const fieldsDisabled = disabled || !value.enabled;
	return (
		<div className="rounded-md border border-border bg-surface-1 p-3" data-testid="memory-audit-settings-panel">
			<div className="mb-2 flex items-center justify-between gap-2">
				<div className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-wider text-text-secondary">
					<BookMarked size={14} />
					<span>Basic Memory audit</span>
				</div>
				<button
					type="button"
					disabled={disabled || isDefault}
					onClick={() => onChange(memoryAuditToInputs(DEFAULT_RUNTIME_MEMORY_FRESHNESS_AUDIT))}
					className="rounded-md border border-border bg-surface-2 px-2 py-1 text-[11px] text-text-secondary hover:bg-surface-3 disabled:opacity-40"
				>
					Reset audit to defaults
				</button>
			</div>
			<p className="mb-2 text-[11px] text-text-secondary">
				A periodic, read-only pass over your Basic Memory notes that flags stale, orphaned, broken-link, and
				duplicate-title notes. Never edits or deletes.
			</p>
			<div className="mb-2 flex flex-col gap-1.5">
				<label className="flex items-center gap-2 text-[12px] text-text-primary">
					<input
						type="checkbox"
						checked={value.enabled}
						disabled={disabled}
						onChange={(event) => onChange({ ...value, enabled: event.target.checked })}
					/>
					<span>Run the memory audit on the idle rail</span>
				</label>
				<label className="flex items-center gap-2 text-[12px] text-text-primary">
					<input
						type="checkbox"
						checked={value.paused}
						disabled={fieldsDisabled}
						onChange={(event) => onChange({ ...value, paused: event.target.checked })}
					/>
					<span>Pause (keeps the settings, skips runs)</span>
				</label>
			</div>
			<div className="grid gap-2 sm:grid-cols-2">
				<div className="rounded-md border border-border bg-surface-2 px-2 py-1.5">
					<label htmlFor={cadenceInputId} className="text-[11px] text-text-tertiary">
						Cadence (days)
					</label>
					<input
						id={cadenceInputId}
						type="number"
						min={MEMORY_AUDIT_DAY_BOUNDS.cadence.min}
						max={MEMORY_AUDIT_DAY_BOUNDS.cadence.max}
						step={1}
						value={value.cadenceDays}
						disabled={fieldsDisabled}
						onChange={(event) => onChange({ ...value, cadenceDays: event.target.value })}
						className="mt-0.5 w-full rounded-sm border border-border bg-surface-1 px-2 py-1 text-[13px] text-text-primary disabled:opacity-40"
					/>
					<div className="mt-1 text-[11px] text-text-secondary">
						How often the audit runs (gated so it never churns).
					</div>
					{isMemoryAuditInputOutOfRange(value.cadenceDays, MEMORY_AUDIT_DAY_BOUNDS.cadence) && (
						<div className="mt-0.5 text-[11px] text-status-red">
							{MEMORY_AUDIT_DAY_BOUNDS.cadence.min}–{MEMORY_AUDIT_DAY_BOUNDS.cadence.max} days (clamped on save).
						</div>
					)}
				</div>
				<div className="rounded-md border border-border bg-surface-2 px-2 py-1.5">
					<label htmlFor={stalenessInputId} className="text-[11px] text-text-tertiary">
						Staleness threshold (days)
					</label>
					<input
						id={stalenessInputId}
						type="number"
						min={MEMORY_AUDIT_DAY_BOUNDS.staleness.min}
						max={MEMORY_AUDIT_DAY_BOUNDS.staleness.max}
						step={1}
						value={value.stalenessDays}
						disabled={fieldsDisabled}
						onChange={(event) => onChange({ ...value, stalenessDays: event.target.value })}
						className="mt-0.5 w-full rounded-sm border border-border bg-surface-1 px-2 py-1 text-[13px] text-text-primary disabled:opacity-40"
					/>
					<div className="mt-1 text-[11px] text-text-secondary">
						A note untouched longer than this is flagged stale.
					</div>
					{isMemoryAuditInputOutOfRange(value.stalenessDays, MEMORY_AUDIT_DAY_BOUNDS.staleness) && (
						<div className="mt-0.5 text-[11px] text-status-red">
							{MEMORY_AUDIT_DAY_BOUNDS.staleness.min}–{MEMORY_AUDIT_DAY_BOUNDS.staleness.max} days (clamped on
							save).
						</div>
					)}
				</div>
			</div>
			<div
				className="mt-3 rounded-md border border-border bg-surface-2 px-2.5 py-2"
				data-testid="memory-audit-status"
			>
				<div className="flex items-center justify-between gap-2">
					<div className="text-[11px] font-semibold uppercase tracking-wider text-text-secondary">
						Retained audit status
					</div>
					<button
						type="button"
						disabled={statusLoading}
						onClick={() => void refreshStatus()}
						className="rounded-sm border border-border bg-surface-1 px-2 py-0.5 text-[11px] text-text-secondary hover:bg-surface-3 disabled:opacity-40"
					>
						{statusLoading ? "Refreshing…" : "Refresh status"}
					</button>
				</div>
				{statusError ? (
					<div className="mt-1.5 text-[11px] text-status-red">Could not read audit status: {statusError}</div>
				) : status ? (
					<div className="mt-1.5 text-[11px] text-text-secondary">
						<div className="font-medium text-text-primary">{auditStateLabel[status.state]}</div>
						<div className="mt-0.5">
							Last: {formatAuditTime(status.lastAuditAt)} · Next: {formatAuditTime(status.nextAuditAt)}
						</div>
						{status.lastAuditAt !== null ? (
							<>
								<div className="mt-1">
									{status.notesAudited} note(s) audited{status.available ? "" : " — no mounted notes found"} ·{" "}
									{status.summary.stale} stale · {status.summary.orphaned} orphaned ·{" "}
									{status.summary.broken_link} broken link(s) · {status.summary.duplicate_title} duplicate
									title(s)
								</div>
								{status.topFindings.length > 0 ? (
									<ul className="mt-1.5 space-y-1 pl-4" data-testid="memory-audit-findings">
										{status.topFindings.map((finding, index) => (
											<li key={`${finding.kind}:${finding.noteTitle}:${index}`}>
												<span className="font-medium text-text-primary">{finding.noteTitle}</span> —{" "}
												{finding.detail}
											</li>
										))}
									</ul>
								) : null}
							</>
						) : null}
					</div>
				) : (
					<div className="mt-1.5 text-[11px] text-text-tertiary">Loading retained audit status…</div>
				)}
			</div>
		</div>
	);
}

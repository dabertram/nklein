// Settings UI for the F5.2 "Basic Memory audit" card (settings-dialog sections), sibling of the swarm-guardrails
// panel. Controlled: the parent owns the inputs value + onChange + dirty/save plumbing (state stays in the settings
// dialog for the unified save). Owns the four editable controls — enable, pause, cadence (days), staleness (days) —
// with per-field out-of-range flagging and a reset-to-defaults action. The audit is read-only (flags stale/orphaned/
// broken-link/duplicate notes, never deletes), so it's safe on by default.
import { areRuntimeMemoryFreshnessAuditEqual, DEFAULT_RUNTIME_MEMORY_FRESHNESS_AUDIT } from "@runtime-contract";
import { BookMarked } from "lucide-react";

import {
	inputsToMemoryAudit,
	isMemoryAuditInputOutOfRange,
	MEMORY_AUDIT_DAY_BOUNDS,
	type MemoryAuditInputs,
	memoryAuditToInputs,
} from "@/components/runtime-settings-memory-audit";

const cadenceInputId = "runtime-settings-memory-audit-cadence";
const stalenessInputId = "runtime-settings-memory-audit-staleness";

export interface MemoryAuditSettingsPanelProps {
	value: MemoryAuditInputs;
	onChange: (next: MemoryAuditInputs) => void;
	disabled?: boolean;
}

export function MemoryAuditSettingsPanel({ value, onChange, disabled = false }: MemoryAuditSettingsPanelProps) {
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
		</div>
	);
}

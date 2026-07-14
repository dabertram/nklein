import { normalizeRuntimeMemoryFreshnessAudit, RUNTIME_MEMORY_FRESHNESS_AUDIT_BOUNDS } from "@runtime-contract";
import type { RuntimeMemoryFreshnessAudit } from "@/runtime/types";

/**
 * F5.2 memory-freshness-audit form conversion for the Settings dialog — the sibling of
 * `runtime-settings-swarm-guardrails.ts`. Pure, self-contained: converts the audit-config wire shape to/from the
 * editable inputs (cadence + staleness expressed in DAYS for the operator), with per-field out-of-range detection so a
 * row can flag that it will be clamped on save. No React/state.
 */

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export const MEMORY_AUDIT_DAY_BOUNDS = {
	cadence: {
		min: RUNTIME_MEMORY_FRESHNESS_AUDIT_BOUNDS.cadenceMs.min / MS_PER_DAY,
		max: RUNTIME_MEMORY_FRESHNESS_AUDIT_BOUNDS.cadenceMs.max / MS_PER_DAY,
	},
	staleness: {
		min: RUNTIME_MEMORY_FRESHNESS_AUDIT_BOUNDS.stalenessThresholdMs.min / MS_PER_DAY,
		max: RUNTIME_MEMORY_FRESHNESS_AUDIT_BOUNDS.stalenessThresholdMs.max / MS_PER_DAY,
	},
} as const;

export interface MemoryAuditInputs {
	enabled: boolean;
	paused: boolean;
	cadenceDays: string;
	stalenessDays: string;
}

function formatDaysInput(ms: number): string {
	const days = ms / MS_PER_DAY;
	return Number.isInteger(days) ? `${days}` : `${Number(days.toFixed(2))}`;
}

export function memoryAuditToInputs(audit: RuntimeMemoryFreshnessAudit): MemoryAuditInputs {
	return {
		enabled: audit.enabled,
		paused: audit.paused,
		cadenceDays: formatDaysInput(audit.cadenceMs),
		stalenessDays: formatDaysInput(audit.stalenessThresholdMs),
	};
}

export function inputsToMemoryAudit(inputs: MemoryAuditInputs): RuntimeMemoryFreshnessAudit {
	const cadenceDays = Number.parseFloat(inputs.cadenceDays);
	const stalenessDays = Number.parseFloat(inputs.stalenessDays);
	return normalizeRuntimeMemoryFreshnessAudit({
		enabled: inputs.enabled,
		paused: inputs.paused,
		cadenceMs: Number.isFinite(cadenceDays) ? Math.round(cadenceDays * MS_PER_DAY) : Number.NaN,
		stalenessThresholdMs: Number.isFinite(stalenessDays) ? Math.round(stalenessDays * MS_PER_DAY) : Number.NaN,
	});
}

/** True when the typed value is empty / not a number / outside its bound, so the row can flag clamp-on-save. */
export function isMemoryAuditInputOutOfRange(value: string, bounds: { min: number; max: number }): boolean {
	const parsed = Number.parseFloat(value);
	return !Number.isFinite(parsed) || parsed < bounds.min || parsed > bounds.max;
}

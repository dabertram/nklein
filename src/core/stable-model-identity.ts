/**
 * Stable model identity (David 2026-07-06 directive). Telemetry — self-observations + fitness measurements — must key
 * off the STABLE publisher model key (`descriptor.modelKey`, e.g. `qwen3.5-9b-mtp`), NOT the LM Studio RUNTIME id
 * (`coder-gpu`, `qwen3-8b-m5max`), which a user renames any time. Keying by the runtime id fragments a model's measured
 * history the moment its instance is renamed. Capability/routing + lineage already use the stable key; this is the
 * shared PURE primitive that (a) resolves a runtime id → its stable key for LIVE stamping, and (b) best-effort re-keys a
 * previously runtime-id-keyed table on load. The runtime id stays only as a display alias.
 *
 * Pure + total: no I/O, no clock. The loaded descriptors (the only source of the stable key) are supplied by the caller.
 */

/** The minimal descriptor shape this module needs: the stable publisher key for a loaded runtime id. */
export interface StableModelKeySource {
	modelKey: string;
}

/**
 * The stable identity for a task's runtime model id. Returns the descriptor's stable `modelKey` when the runtime id is
 * a currently-loaded model; otherwise falls back to the trimmed runtime id (a cloud provider, or a not-currently-loaded
 * model, has no local descriptor — its id is treated as-is, which for cloud ids IS stable). Never returns empty.
 */
export function resolveStableModelKey(
	runtimeModelId: string,
	descriptorsByRuntimeId: ReadonlyMap<string, StableModelKeySource>,
): string {
	const stable = descriptorsByRuntimeId.get(runtimeModelId)?.modelKey?.trim();
	if (stable && stable.length > 0) {
		return stable;
	}
	return runtimeModelId.trim();
}

/**
 * Best-effort re-key of a telemetry table (rows keyed by the id stamped when the row was written — a runtime id for
 * legacy rows) to stable model keys. `resolveStableKey` maps a stored key → its stable key (returns the SAME string
 * when it can't be improved — e.g. no matching descriptor, so the row decays under its original key). Two stored keys
 * that collapse to the same stable key are combined via `mergeRows` (domain-specific — e.g. summing fitness samples).
 * Order-preserving on first appearance of each stable key.
 */
export function rekeyTableToStableModelKeys<TRow>(
	rowsByStoredKey: Readonly<Record<string, TRow>>,
	resolveStableKey: (storedKey: string) => string,
	mergeRows: (existing: TRow, incoming: TRow) => TRow,
): Record<string, TRow> {
	const out: Record<string, TRow> = {};
	for (const [storedKey, row] of Object.entries(rowsByStoredKey)) {
		const stableKey = resolveStableKey(storedKey).trim() || storedKey;
		const existing = out[stableKey];
		out[stableKey] = existing === undefined ? row : mergeRows(existing, row);
	}
	return out;
}

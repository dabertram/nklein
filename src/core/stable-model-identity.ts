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
 * A persisted `runtimeId → stable modelKey` map (David 2026-07-07 decision): the missing piece that lets a COLD model
 * (a config/role candidate not currently loaded, so absent from the live descriptors) still resolve to its stable key.
 * !Klein LEARNS this map whenever a model IS loaded (from its descriptor) and persists it, so the keyspace is uniformly
 * stable even at write sites that see no live descriptor — closing the mixed-keyspace hazard that a live-only resolver
 * leaves. Just a plain string→string record; the store layer owns load/save.
 */
export type RuntimeIdToModelKeyMap = Readonly<Record<string, string>>;

/**
 * Learn/refresh the persisted map from the currently-loaded descriptors: each loaded `runtimeId` records its stable
 * `modelKey` (last-seen wins — a runtime id's stable key is whatever it most recently resolved to). Entries for ids NOT
 * currently loaded are RETAINED — that is the whole point: a renamed/cold model still resolves from what we learned when
 * it was last loaded. Pure; blank ids/keys are skipped.
 */
export function learnRuntimeIdModelKeyMap(
	existing: RuntimeIdToModelKeyMap,
	descriptors: readonly { runtimeId: string; modelKey: string }[],
): RuntimeIdToModelKeyMap {
	const out: Record<string, string> = { ...existing };
	for (const descriptor of descriptors) {
		const runtimeId = descriptor.runtimeId.trim();
		const modelKey = descriptor.modelKey.trim();
		if (runtimeId && modelKey) {
			out[runtimeId] = modelKey;
		}
	}
	return out;
}

/**
 * Resolve a runtime id → its stable key, preferring the LIVE descriptor (authoritative), then the PERSISTED map (so a
 * cold model still resolves), then the runtime id itself (a cloud/unknown id is treated as already-stable). Never empty.
 * This is the uniform-keyspace resolver the §5.BG flip keys writes by.
 */
export function resolveStableModelKeyWithMap(
	runtimeModelId: string,
	liveDescriptorsByRuntimeId: ReadonlyMap<string, StableModelKeySource>,
	persistedMap: RuntimeIdToModelKeyMap,
): string {
	const id = runtimeModelId.trim();
	const live = liveDescriptorsByRuntimeId.get(runtimeModelId)?.modelKey?.trim();
	if (live && live.length > 0) {
		return live;
	}
	const persisted = persistedMap[id]?.trim();
	if (persisted && persisted.length > 0) {
		return persisted;
	}
	return id;
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

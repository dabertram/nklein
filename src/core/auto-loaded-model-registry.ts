/**
 * F1.23 — the registry of models !Klein AUTONOMOUSLY loaded (via the NKLEIN_DEVICE_RAM_GB machine-aware loader),
 * so the scheduler's idle-TTL eviction can reclaim EXACTLY what !Klein loaded and nothing else. Operator-loaded
 * models never enter this registry, which is what makes the eviction safe by construction (resident models are
 * sacred — prime directive). In-memory + process-scoped: a restart forgets the set, so previously-auto-loaded
 * models silently become resident-protected — the FAIL-SAFE direction (we may reclaim less, never more).
 */

export interface AutoLoadedModelRecord {
	modelId: string;
	loadedAtMs: number;
	lastUsedAtMs: number | null;
}

export interface AutoLoadedModelRegistry {
	/** Record a successful autonomous load (idempotent — a re-load refreshes loadedAt, keeps lastUsed). */
	recordLoad(modelId: string, now: number): void;
	/** Mark the model as just-used (a session started/ran on it) — resets its idle clock. */
	markUsed(modelId: string, now: number): void;
	/** Forget the model (it was unloaded — by us or anyone else). */
	forget(modelId: string): void;
	list(): AutoLoadedModelRecord[];
}

export function createAutoLoadedModelRegistry(): AutoLoadedModelRegistry {
	const records = new Map<string, AutoLoadedModelRecord>();
	return {
		recordLoad(modelId, now) {
			const existing = records.get(modelId);
			records.set(modelId, {
				modelId,
				loadedAtMs: now,
				lastUsedAtMs: existing?.lastUsedAtMs ?? null,
			});
		},
		markUsed(modelId, now) {
			const existing = records.get(modelId);
			if (existing) {
				existing.lastUsedAtMs = now;
			}
		},
		forget(modelId) {
			records.delete(modelId);
		},
		list() {
			return [...records.values()].map((record) => ({ ...record }));
		},
	};
}

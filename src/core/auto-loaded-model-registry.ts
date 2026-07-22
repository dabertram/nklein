/**
 * F1.23 — the registry of models !Klein AUTONOMOUSLY loaded (via the NKLEIN_DEVICE_RAM_GB machine-aware loader),
 * so capacity admission can reclaim EXACTLY what !Klein loaded after its idle TTL and nothing else. Operator-loaded
 * models never enter this registry, which is what makes the eviction safe by construction (resident models are
 * sacred — prime directive). In-memory + process-scoped: a restart forgets the set, so previously-auto-loaded
 * models silently become resident-protected — the FAIL-SAFE direction (we may reclaim less, never more).
 */

export interface AutoLoadedModelRecord {
	modelId: string;
	/** LM-Link device chosen for the load; absent only for legacy/tests that did not record placement. */
	deviceName?: string;
	loadedAtMs: number;
	lastUsedAtMs: number | null;
}

export interface AutoLoadedModelRegistry {
	/** Record a successful autonomous load (idempotent — a re-load refreshes both warm clocks). */
	recordLoad(modelId: string, now: number, deviceName?: string): void;
	/** Mark the model as just-used (a session started/ran on it) — resets its idle clock. */
	markUsed(modelId: string, now: number): void;
	/** Hold a model for one active/queued task. Unknown/operator models remain outside the reclaim registry. */
	reserveUse(modelId: string, reservationId: string): void;
	/** Release a task hold and stamp completion as the latest use, so long sessions receive a fresh idle window. */
	releaseUse(reservationId: string, now: number): void;
	/** Models protected by at least one active/queued task across all workspaces. */
	reservedModelIds(): string[];
	/** Replace one workspace's queued/ready model needs; process-wide union protects cross-workspace work. */
	setWorkspaceNeededModels(workspaceId: string, modelIds: readonly string[]): void;
	clearWorkspaceNeededModels(workspaceId: string): void;
	neededModelIds(): string[];
	/** Forget one host copy, or every copy when placement is unknown (legacy/reconciliation path). */
	forget(modelId: string, deviceName?: string): void;
	list(): AutoLoadedModelRecord[];
}

/** Stable cross-module key for one task's model-use hold. */
export function modelUseReservationId(workspaceId: string, taskId: string): string {
	return JSON.stringify([workspaceId, taskId]);
}

export function createAutoLoadedModelRegistry(): AutoLoadedModelRegistry {
	const records = new Map<string, AutoLoadedModelRecord>();
	const reservations = new Map<string, string>();
	const neededByWorkspace = new Map<string, Set<string>>();
	const recordKey = (modelId: string, deviceName?: string) => JSON.stringify([deviceName ?? null, modelId]);
	return {
		recordLoad(modelId, now, deviceName) {
			const key = recordKey(modelId, deviceName);
			const existing = records.get(key);
			records.set(key, {
				modelId,
				...(deviceName !== undefined
					? { deviceName }
					: existing?.deviceName !== undefined
						? { deviceName: existing.deviceName }
						: {}),
				loadedAtMs: now,
				lastUsedAtMs: existing ? now : null,
			});
		},
		markUsed(modelId, now) {
			for (const record of records.values()) {
				if (record.modelId === modelId) record.lastUsedAtMs = now;
			}
		},
		reserveUse(modelId, reservationId) {
			if ([...records.values()].some((record) => record.modelId === modelId)) {
				reservations.set(reservationId, modelId);
			} else {
				reservations.delete(reservationId);
			}
		},
		releaseUse(reservationId, now) {
			const modelId = reservations.get(reservationId);
			if (modelId === undefined) {
				return;
			}
			reservations.delete(reservationId);
			for (const record of records.values()) {
				if (record.modelId === modelId) record.lastUsedAtMs = now;
			}
		},
		reservedModelIds() {
			return [...new Set(reservations.values())];
		},
		setWorkspaceNeededModels(workspaceId, modelIds) {
			neededByWorkspace.set(workspaceId, new Set(modelIds));
		},
		clearWorkspaceNeededModels(workspaceId) {
			neededByWorkspace.delete(workspaceId);
		},
		neededModelIds() {
			return [...new Set([...neededByWorkspace.values()].flatMap((models) => [...models]))];
		},
		forget(modelId, deviceName) {
			if (deviceName !== undefined) {
				records.delete(recordKey(modelId, deviceName));
			} else {
				for (const [key, record] of records) {
					if (record.modelId === modelId) records.delete(key);
				}
			}
			const stillTracked = [...records.values()].some((record) => record.modelId === modelId);
			for (const [reservationId, reservedModelId] of reservations) {
				if (!stillTracked && reservedModelId === modelId) {
					reservations.delete(reservationId);
				}
			}
		},
		list() {
			return [...records.values()].map((record) => ({ ...record }));
		},
	};
}

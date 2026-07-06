/** The model id used when a task has no configured model yet. */
export const UNCONFIGURED_MODEL_ID = "unconfigured";

/**
 * Per-task model id + endpoint, extracted from InMemoryNKleinTaskSessionService.
 *
 * The two are set together when a task launches (or when its launch config is cached) and read
 * together wherever the runtime builds a model observation / telemetry row. The model id falls
 * back to {@link UNCONFIGURED_MODEL_ID} and the endpoint to null — the same defaults every call
 * site used inline.
 *
 * Behavior-preserving: {@link set} mirrors the two inline `.set()`s; {@link getModelId} /
 * {@link getEndpoint} bake in the call-site defaults; {@link peekModelId} / {@link peekEndpoint}
 * expose the raw values for the few reads that chain their own `summary.x ?? … ?? null` fallback;
 * {@link forget} drops both (they were always deleted together across every cleanup path).
 */
export class TaskModelEndpointStore {
	private readonly modelIdByTaskId = new Map<string, string>();
	private readonly endpointByTaskId = new Map<string, string | null>();
	/**
	 * §5.BG: the STABLE publisher model key (`descriptor.modelKey`) for the task, when it could be resolved at start.
	 * Distinct from `modelId` (the runtime/LM Studio id used to CALL the endpoint, which a user renames): this is the
	 * identity telemetry/observations key off, so a renamed instance doesn't fragment its measured history. Absent for
	 * cloud/not-locally-loaded models and on the restart path ⇒ callers fall back to `getModelId`.
	 */
	private readonly stableModelKeyByTaskId = new Map<string, string>();

	set(taskId: string, modelId: string, endpoint: string | null, stableModelKey?: string | null): void {
		this.modelIdByTaskId.set(taskId, modelId);
		this.endpointByTaskId.set(taskId, endpoint);
		const stable = stableModelKey?.trim();
		if (stable && stable.length > 0) {
			this.stableModelKeyByTaskId.set(taskId, stable);
		} else {
			this.stableModelKeyByTaskId.delete(taskId);
		}
	}

	/** The task's model id, or {@link UNCONFIGURED_MODEL_ID} if none was recorded. */
	getModelId(taskId: string): string {
		return this.modelIdByTaskId.get(taskId) ?? UNCONFIGURED_MODEL_ID;
	}

	/**
	 * The task's STABLE model key (`descriptor.modelKey`), or null when it wasn't resolvable (cloud / not-loaded /
	 * restart). Telemetry stamps this in preference to {@link getModelId} so a runtime-id rename can't fragment history.
	 */
	getStableModelKey(taskId: string): string | null {
		return this.stableModelKeyByTaskId.get(taskId) ?? null;
	}

	/** The raw recorded model id (undefined if none) — for callers that chain their own fallback. */
	peekModelId(taskId: string): string | undefined {
		return this.modelIdByTaskId.get(taskId);
	}

	/**
	 * The task's endpoint, or null if none was recorded. Safe to use even in a chained
	 * `summary.endpoint ?? getEndpoint(taskId)` position — the baked-in `?? null` is idempotent
	 * there (the prior inline `… ?? get ?? null` collapses to the same value).
	 */
	getEndpoint(taskId: string): string | null {
		return this.endpointByTaskId.get(taskId) ?? null;
	}

	/** Drops the model id, endpoint, and stable key for the task (always cleaned together). */
	forget(taskId: string): void {
		this.modelIdByTaskId.delete(taskId);
		this.endpointByTaskId.delete(taskId);
		this.stableModelKeyByTaskId.delete(taskId);
	}

	clear(): void {
		this.modelIdByTaskId.clear();
		this.endpointByTaskId.clear();
		this.stableModelKeyByTaskId.clear();
	}
}

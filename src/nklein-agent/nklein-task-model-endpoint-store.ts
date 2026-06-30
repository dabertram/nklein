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

	set(taskId: string, modelId: string, endpoint: string | null): void {
		this.modelIdByTaskId.set(taskId, modelId);
		this.endpointByTaskId.set(taskId, endpoint);
	}

	/** The task's model id, or {@link UNCONFIGURED_MODEL_ID} if none was recorded. */
	getModelId(taskId: string): string {
		return this.modelIdByTaskId.get(taskId) ?? UNCONFIGURED_MODEL_ID;
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

	/** Drops both the model id and endpoint for the task (always cleaned together). */
	forget(taskId: string): void {
		this.modelIdByTaskId.delete(taskId);
		this.endpointByTaskId.delete(taskId);
	}

	clear(): void {
		this.modelIdByTaskId.clear();
		this.endpointByTaskId.clear();
	}
}

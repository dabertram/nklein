import { z } from "zod";
import { type RuntimeTaskSessionStartRequest, runtimeTaskSessionStartRequestSchema } from "../core/api-contract";
import { parseValidatedJsonl } from "../state/jsonl-store";
import type { RuntimeTrpcWorkspaceScope } from "./app-router";

export interface QueuedRuntimeTaskStart {
	workspaceScope: RuntimeTrpcWorkspaceScope;
	input: RuntimeTaskSessionStartRequest;
	queuedAt: number;
	nextAttemptAt: number;
	attempts: number;
	lastError: string | null;
}

export interface RuntimeTaskStartQueue {
	enqueue(input: {
		workspaceScope: RuntimeTrpcWorkspaceScope;
		request: RuntimeTaskSessionStartRequest;
		delayMs?: number | null;
		error?: string | null;
		now?: number;
	}): QueuedRuntimeTaskStart;
	remove(workspaceId: string, taskId: string): void;
	takeReady(workspaceId: string, options?: { force?: boolean; now?: number }): QueuedRuntimeTaskStart[];
	clearWorkspace(workspaceId: string): void;
	size(workspaceId?: string): number;
	/** Every queued start across all workspaces — for persisting a durable snapshot. */
	snapshot(): QueuedRuntimeTaskStart[];
	/** Replace the in-memory queue with a persisted snapshot (preserves `queuedAt`/`attempts`/`nextAttemptAt`). */
	hydrate(entries: readonly QueuedRuntimeTaskStart[]): void;
}

function cloneQueuedRequest(request: RuntimeTaskSessionStartRequest): RuntimeTaskSessionStartRequest {
	return {
		...request,
		images: request.images ? request.images.map((image) => ({ ...image })) : undefined,
		nkleinSettings: request.nkleinSettings ? { ...request.nkleinSettings } : undefined,
		queueOnEndpointBusy: true,
	};
}

function cloneWorkspaceScope(scope: RuntimeTrpcWorkspaceScope): RuntimeTrpcWorkspaceScope {
	return {
		workspaceId: scope.workspaceId,
		workspacePath: scope.workspacePath,
	};
}

function createQueueKey(workspaceId: string, taskId: string): string {
	return `${workspaceId}\0${taskId}`;
}

export function createRuntimeTaskStartQueue(): RuntimeTaskStartQueue {
	const queuedByKey = new Map<string, QueuedRuntimeTaskStart>();

	return {
		enqueue(input) {
			const now = input.now ?? Date.now();
			const key = createQueueKey(input.workspaceScope.workspaceId, input.request.taskId);
			const existing = queuedByKey.get(key);
			const delayMs =
				typeof input.delayMs === "number" && Number.isFinite(input.delayMs) && input.delayMs > 0
					? Math.trunc(input.delayMs)
					: 0;
			const queued: QueuedRuntimeTaskStart = {
				workspaceScope: cloneWorkspaceScope(input.workspaceScope),
				input: cloneQueuedRequest(input.request),
				queuedAt: existing?.queuedAt ?? now,
				nextAttemptAt: now + delayMs,
				attempts: (existing?.attempts ?? 0) + 1,
				lastError: input.error ?? existing?.lastError ?? null,
			};
			queuedByKey.set(key, queued);
			return queued;
		},
		remove(workspaceId, taskId) {
			queuedByKey.delete(createQueueKey(workspaceId, taskId));
		},
		takeReady(workspaceId, options) {
			const now = options?.now ?? Date.now();
			const ready: QueuedRuntimeTaskStart[] = [];
			for (const [key, queued] of queuedByKey.entries()) {
				if (queued.workspaceScope.workspaceId !== workspaceId) {
					continue;
				}
				if (!options?.force && queued.nextAttemptAt > now) {
					continue;
				}
				queuedByKey.delete(key);
				ready.push(queued);
			}
			ready.sort(
				(left, right) => left.queuedAt - right.queuedAt || left.input.taskId.localeCompare(right.input.taskId),
			);
			return ready;
		},
		clearWorkspace(workspaceId) {
			for (const [key, queued] of queuedByKey.entries()) {
				if (queued.workspaceScope.workspaceId === workspaceId) {
					queuedByKey.delete(key);
				}
			}
		},
		size(workspaceId) {
			if (!workspaceId) {
				return queuedByKey.size;
			}
			let count = 0;
			for (const queued of queuedByKey.values()) {
				if (queued.workspaceScope.workspaceId === workspaceId) {
					count += 1;
				}
			}
			return count;
		},
		snapshot() {
			return [...queuedByKey.values()].map((queued) => ({
				workspaceScope: cloneWorkspaceScope(queued.workspaceScope),
				input: cloneQueuedRequest(queued.input),
				queuedAt: queued.queuedAt,
				nextAttemptAt: queued.nextAttemptAt,
				attempts: queued.attempts,
				lastError: queued.lastError,
			}));
		},
		hydrate(entries) {
			queuedByKey.clear();
			for (const entry of entries) {
				queuedByKey.set(createQueueKey(entry.workspaceScope.workspaceId, entry.input.taskId), {
					workspaceScope: cloneWorkspaceScope(entry.workspaceScope),
					input: cloneQueuedRequest(entry.input),
					queuedAt: entry.queuedAt,
					nextAttemptAt: entry.nextAttemptAt,
					attempts: entry.attempts,
					lastError: entry.lastError,
				});
			}
		},
	};
}

/**
 * On-disk shape of one queued start — drift-guarded against `QueuedRuntimeTaskStart` so the persisted format and the
 * in-memory type can't silently diverge. The pure half of the §5.AF durable queued-start store (so the queue survives
 * a runtime restart); the file I/O wrapper + the runtime-server wiring that loads/persists it are the remaining work.
 */
export const queuedRuntimeTaskStartSchema = z.object({
	workspaceScope: z.object({ workspaceId: z.string(), workspacePath: z.string() }),
	input: runtimeTaskSessionStartRequestSchema,
	queuedAt: z.number(),
	nextAttemptAt: z.number(),
	attempts: z.number(),
	lastError: z.string().nullable(),
});
const _queuedStartDriftGuard: z.ZodType<QueuedRuntimeTaskStart> = queuedRuntimeTaskStartSchema;
void _queuedStartDriftGuard;

/** Serialize the queue's entries to JSONL (one start per line) for the durable store. */
export function serializeQueuedTaskStarts(entries: readonly QueuedRuntimeTaskStart[]): string {
	return entries.map((entry) => JSON.stringify(entry)).join("\n");
}

/** Parse durable-store JSONL back into queued starts — schema-validated, skipping (+ diagnosing) any invalid line. */
export function parseQueuedTaskStarts(content: string): QueuedRuntimeTaskStart[] {
	return parseValidatedJsonl(content, queuedRuntimeTaskStartSchema, "runtime-task-start-queue");
}

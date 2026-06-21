import type { RuntimeTaskSessionStartRequest } from "../core/api-contract";
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
	};
}

import { createHash } from "node:crypto";

import type { ProtectedTestApprovalRequest } from "./agent-write-guard";

export interface ProtectedTestApprovalGrant {
	taskId: string;
	workspacePath?: string | null;
	request: ProtectedTestApprovalRequest;
	approvedAt: number;
}

export interface ProtectedTestApprovalStore {
	grant(grant: ProtectedTestApprovalGrant): void;
	consume(input: { taskId?: string | null; request: ProtectedTestApprovalRequest }): ProtectedTestApprovalGrant | null;
	clear(): void;
}

function stableApprovalJson(request: ProtectedTestApprovalRequest): string {
	return JSON.stringify({
		intent: request.intent,
		diff: request.diff,
		reason: request.reason,
		expectedEffects: request.expectedEffects,
	});
}

export function buildProtectedTestApprovalKey(taskId: string, request: ProtectedTestApprovalRequest): string {
	const digest = createHash("sha256").update(stableApprovalJson(request)).digest("hex");
	return `${taskId}:${digest}`;
}

export function createProtectedTestApprovalStore(): ProtectedTestApprovalStore {
	const grants = new Map<string, ProtectedTestApprovalGrant>();
	return {
		grant(grant) {
			grants.set(buildProtectedTestApprovalKey(grant.taskId, grant.request), grant);
		},
		consume(input) {
			const taskId = input.taskId?.trim();
			const key = taskId ? buildProtectedTestApprovalKey(taskId, input.request) : null;
			const fallbackEntry = !key
				? [...grants.entries()].find(
						([_entryKey, entry]) => stableApprovalJson(entry.request) === stableApprovalJson(input.request),
					)
				: null;
			const grant = key ? (grants.get(key) ?? null) : (fallbackEntry?.[1] ?? null);
			if (grant) {
				grants.delete(key ?? fallbackEntry?.[0] ?? "");
			}
			return grant;
		},
		clear() {
			grants.clear();
		},
	};
}

export const protectedTestApprovalStore = createProtectedTestApprovalStore();

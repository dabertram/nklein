/**
 * Process-local ownership registry for speculative attempts.
 *
 * Task/session summaries are presentation state: autonomy guards may project a synthetic task out of `running`
 * before its SDK promise releases the model endpoint. The promise owner must therefore register at launch and
 * unregister only from `finally`; schedulers use this registry for ceilings and preemption.
 */
export class SpeculativeAttemptRegistry {
	private readonly primaryTaskIdsByWorkspaceId = new Map<string, Set<string>>();

	begin(workspaceId: string, primaryTaskId: string): void {
		const active = this.primaryTaskIdsByWorkspaceId.get(workspaceId) ?? new Set<string>();
		active.add(primaryTaskId);
		this.primaryTaskIdsByWorkspaceId.set(workspaceId, active);
	}

	end(workspaceId: string, primaryTaskId: string): void {
		const active = this.primaryTaskIdsByWorkspaceId.get(workspaceId);
		if (!active) return;
		active.delete(primaryTaskId);
		if (active.size === 0) this.primaryTaskIdsByWorkspaceId.delete(workspaceId);
	}

	list(workspaceId: string): string[] {
		return [...(this.primaryTaskIdsByWorkspaceId.get(workspaceId) ?? [])].sort();
	}

	count(workspaceId: string): number {
		return this.primaryTaskIdsByWorkspaceId.get(workspaceId)?.size ?? 0;
	}

	clearWorkspace(workspaceId: string): void {
		this.primaryTaskIdsByWorkspaceId.delete(workspaceId);
	}
}

import type { NKleinRuntimeSetup } from "./nklein-runtime-setup";
import type { NKleinRuntimeSetupLease } from "./nklein-watcher-registry";

/**
 * §5.U — the per-workspace runtime-setup lease cache extracted from `InMemoryNKleinTaskSessionService` as a bounded
 * collaborator. It de-dupes concurrent runtime setup for the same workspace (multiple tasks starting at once share ONE
 * `acquire` lease promise) and releases every held lease on dispose. Self-contained: one Map + the injected `acquire`.
 */
export interface RuntimeSetupLeaseCache {
	/** The runtime setup for a workspace, acquiring (and caching) a lease on first use so concurrent callers share it. */
	ensure(workspacePath: string): Promise<NKleinRuntimeSetup>;
	/** Release every held lease (best-effort) and drop the cache. */
	disposeAll(): Promise<void>;
}

export function createRuntimeSetupLeaseCache(deps: {
	acquire: (workspacePath: string) => Promise<NKleinRuntimeSetupLease>;
}): RuntimeSetupLeaseCache {
	const leaseByWorkspacePath = new Map<string, Promise<NKleinRuntimeSetupLease>>();

	async function ensure(workspacePath: string): Promise<NKleinRuntimeSetup> {
		const normalizedWorkspacePath = workspacePath.trim();
		let leasePromise = leaseByWorkspacePath.get(normalizedWorkspacePath);
		if (!leasePromise) {
			leasePromise = deps.acquire(normalizedWorkspacePath);
			leaseByWorkspacePath.set(normalizedWorkspacePath, leasePromise);
		}
		const lease = await leasePromise;
		return lease.setup;
	}

	async function disposeAll(): Promise<void> {
		for (const leasePromise of leaseByWorkspacePath.values()) {
			try {
				const lease = await leasePromise;
				await lease.release();
			} catch {
				// Ignore runtime setup disposal failures.
			}
		}
		leaseByWorkspacePath.clear();
	}

	return { ensure, disposeAll };
}

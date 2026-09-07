import { describe, expect, it, vi } from "vitest";

/**
 * Regression for the silent death of plan sizing (live 2026-09-07, dev-test 01 through the HITL rig): the model
 * registry's `getSnapshot()` is OVERLOADED — a Promise while it still has to load, the cached snapshot
 * SYNCHRONOUSLY ever after — and this module chained `.catch()` straight onto it. Once the registry had warmed up
 * that threw `TypeError: … .catch is not a function`, the throw escaped the function, and every caller's own
 * `.catch(() => [])` turned it into ZERO candidates. Downstream, `assessPlannedTaskSizing` then had no context
 * window and reported `no verdict — no_context_window` for every card, so P21.6b sizing (and its enforcement flag)
 * never fired again in that process.
 */
const registry = vi.hoisted(() => ({ getSnapshot: vi.fn() }));
vi.mock("../../../../src/nklein-agent/nklein-model-registry", () => ({
	getDefaultNKleinModelRegistry: () => registry,
}));
// Keep the test on the registry seam alone: no provider is runnable, so the function returns [] either way — what
// matters is that it RETURNS rather than throwing.
vi.mock("../../../../src/nklein-agent/nklein-provider-service", () => ({
	createNKleinProviderService: () => ({
		resolveLaunchConfig: async () => {
			throw new Error("no runnable provider in this test");
		},
	}),
}));

const SNAPSHOT = { schemaVersion: 1 as const, updatedAt: 0, models: {} };

describe("buildDecompositionRoutingCandidates — the model-registry snapshot seam", () => {
	it("survives a SYNCHRONOUS cached snapshot (the shape that silently killed plan sizing)", async () => {
		const { buildDecompositionRoutingCandidates } = await import(
			"../../../../src/nklein-agent/decomposition/build-decomposition-routing-candidates"
		);
		// The cached path: a plain object, no `.catch` on it.
		registry.getSnapshot.mockReturnValue(SNAPSHOT);
		await expect(
			buildDecompositionRoutingCandidates({ effectiveModelRoles: {} } as never, { loadedOnly: true }),
		).resolves.toEqual([]);
		expect(registry.getSnapshot).toHaveBeenCalled();
	});

	it("still works for the loading path (a Promise) and for a rejecting snapshot", async () => {
		const { buildDecompositionRoutingCandidates } = await import(
			"../../../../src/nklein-agent/decomposition/build-decomposition-routing-candidates"
		);
		registry.getSnapshot.mockReturnValue(Promise.resolve(SNAPSHOT));
		await expect(buildDecompositionRoutingCandidates({ effectiveModelRoles: {} } as never, {})).resolves.toEqual([]);
		// A registry that cannot be read must degrade to an empty registry, never propagate.
		registry.getSnapshot.mockReturnValue(Promise.reject(new Error("registry unreadable")));
		await expect(buildDecompositionRoutingCandidates({ effectiveModelRoles: {} } as never, {})).resolves.toEqual([]);
	});
});

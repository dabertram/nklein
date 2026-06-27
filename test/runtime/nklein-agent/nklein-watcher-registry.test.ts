import { describe, expect, it } from "vitest";
import type { NKleinRuntimeSetup } from "../../../src/nklein-agent/nklein-runtime-setup";
import { createNKleinWatcherRegistry } from "../../../src/nklein-agent/nklein-watcher-registry";

// The registry only ever touches `setup.dispose()`, so a minimal fake exercising disposal is sufficient; the cast is
// the test seam (the rest of the large NKleinRuntimeSetup surface is irrelevant to ref-counting behavior).
function makeTrackedSetup(disposeError?: Error): { setup: NKleinRuntimeSetup; disposeCalls: () => number } {
	let disposeCalls = 0;
	const setup = {
		dispose: async (): Promise<void> => {
			disposeCalls += 1;
			if (disposeError) {
				throw disposeError;
			}
		},
	} as unknown as NKleinRuntimeSetup;
	return { setup, disposeCalls: () => disposeCalls };
}

// A createRuntimeSetup fake that hands out queued setups in order and records the (normalized) workspace paths it saw.
function queuedFactory(setups: readonly NKleinRuntimeSetup[]): {
	create: (workspacePath: string) => Promise<NKleinRuntimeSetup>;
	calls: () => readonly string[];
} {
	const calls: string[] = [];
	let index = 0;
	return {
		create: async (workspacePath) => {
			calls.push(workspacePath);
			const setup = setups[index];
			index += 1;
			if (!setup) {
				throw new Error("queuedFactory: no more setups queued");
			}
			return setup;
		},
		calls: () => calls,
	};
}

describe("createNKleinWatcherRegistry", () => {
	it("creates a runtime setup once per workspace and returns it", async () => {
		const a = makeTrackedSetup();
		const factory = queuedFactory([a.setup]);
		const registry = createNKleinWatcherRegistry({ createRuntimeSetup: factory.create });

		const lease = await registry.acquire("/ws");

		expect(lease.setup).toBe(a.setup);
		expect(factory.calls()).toEqual(["/ws"]);
	});

	it("ref-counts: a shared setup is disposed only when the last lease releases", async () => {
		const a = makeTrackedSetup();
		const factory = queuedFactory([a.setup]);
		const registry = createNKleinWatcherRegistry({ createRuntimeSetup: factory.create });

		const lease1 = await registry.acquire("/ws");
		const lease2 = await registry.acquire("/ws");

		expect(factory.calls()).toEqual(["/ws"]); // shared, not re-created
		expect(lease1.setup).toBe(lease2.setup);

		await lease1.release();
		expect(a.disposeCalls()).toBe(0); // one holder remains

		await lease2.release();
		expect(a.disposeCalls()).toBe(1); // disposed when refCount hits 0
	});

	it("re-acquires a fresh setup after the entry was fully released", async () => {
		const a = makeTrackedSetup();
		const b = makeTrackedSetup();
		const factory = queuedFactory([a.setup, b.setup]);
		const registry = createNKleinWatcherRegistry({ createRuntimeSetup: factory.create });

		const lease1 = await registry.acquire("/ws");
		await lease1.release();
		expect(a.disposeCalls()).toBe(1);

		const lease2 = await registry.acquire("/ws");
		expect(lease2.setup).toBe(b.setup); // entry was removed → recreated
		expect(factory.calls()).toEqual(["/ws", "/ws"]);
	});

	it("normalizes the workspace path so trimmed variants share one entry", async () => {
		const a = makeTrackedSetup();
		const factory = queuedFactory([a.setup]);
		const registry = createNKleinWatcherRegistry({ createRuntimeSetup: factory.create });

		const lease1 = await registry.acquire("  /ws  ");
		const lease2 = await registry.acquire("/ws");

		expect(lease1.setup).toBe(lease2.setup);
		expect(factory.calls()).toEqual(["/ws"]); // single creation, normalized
	});

	it("keeps separate setups per distinct workspace", async () => {
		const a = makeTrackedSetup();
		const b = makeTrackedSetup();
		const factory = queuedFactory([a.setup, b.setup]);
		const registry = createNKleinWatcherRegistry({ createRuntimeSetup: factory.create });

		const leaseA = await registry.acquire("/a");
		const leaseB = await registry.acquire("/b");

		expect(leaseA.setup).toBe(a.setup);
		expect(leaseB.setup).toBe(b.setup);
		expect(factory.calls()).toEqual(["/a", "/b"]);
	});

	it("cleans up the entry when creation fails so the next acquire retries", async () => {
		const b = makeTrackedSetup();
		let call = 0;
		const registry = createNKleinWatcherRegistry({
			createRuntimeSetup: async () => {
				call += 1;
				if (call === 1) {
					throw new Error("setup boom");
				}
				return b.setup;
			},
		});

		await expect(registry.acquire("/ws")).rejects.toThrow("setup boom");

		const lease = await registry.acquire("/ws");
		expect(lease.setup).toBe(b.setup); // entry was not left poisoned
		expect(call).toBe(2);
	});

	it("close() disposes every active setup regardless of its ref-count", async () => {
		const a = makeTrackedSetup();
		const b = makeTrackedSetup();
		const factory = queuedFactory([a.setup, b.setup]);
		const registry = createNKleinWatcherRegistry({ createRuntimeSetup: factory.create });

		await registry.acquire("/a");
		await registry.acquire("/a"); // refCount 2
		await registry.acquire("/b"); // refCount 1

		await registry.close();

		expect(a.disposeCalls()).toBe(1);
		expect(b.disposeCalls()).toBe(1);
	});

	it("swallows dispose errors and treats over-release as a no-op", async () => {
		const a = makeTrackedSetup(new Error("dispose boom"));
		const factory = queuedFactory([a.setup]);
		const registry = createNKleinWatcherRegistry({ createRuntimeSetup: factory.create });

		const lease = await registry.acquire("/ws");

		await expect(lease.release()).resolves.toBeUndefined(); // dispose threw, but release does not reject
		expect(a.disposeCalls()).toBe(1);

		await expect(lease.release()).resolves.toBeUndefined(); // entry already gone → no-op, no second dispose
		expect(a.disposeCalls()).toBe(1);
	});
});

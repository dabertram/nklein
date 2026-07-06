import { describe, expect, it, vi } from "vitest";
import type { FocusChain } from "../../../src/core/focus-chain";
import { createFocusChainStore } from "../../../src/nklein-agent/nklein-focus-chain-store";

const chain = (steps: Array<{ id: string; status: string }>): FocusChain => ({ steps }) as unknown as FocusChain;

describe("createFocusChainStore (§5.U extraction)", () => {
	it("stores an applied chain, notifies onUpdated with the timed chain, and summarizes it", () => {
		const onUpdated = vi.fn();
		const store = createFocusChainStore({ now: () => 1000, onUpdated });

		store.applyStep("t1", chain([{ id: "s1", status: "in_progress" }]));
		expect(onUpdated).toHaveBeenCalledTimes(1);
		expect(onUpdated).toHaveBeenCalledWith("t1", expect.objectContaining({ steps: expect.any(Array) }));

		const summary = store.summarize("t1");
		expect(summary).not.toBeNull();
		expect(summary?.total).toBe(1);
		expect(summary?.inProgress).toBe(1);
	});

	it("summarize returns null for an untracked task", () => {
		const store = createFocusChainStore({ now: () => 0 });
		expect(store.summarize("nope")).toBeNull();
	});

	it("delete forgets one task; clear forgets all", () => {
		const store = createFocusChainStore({ now: () => 0 });
		store.applyStep("a", chain([{ id: "s", status: "done" }]));
		store.applyStep("b", chain([{ id: "s", status: "done" }]));
		store.delete("a");
		expect(store.summarize("a")).toBeNull();
		expect(store.summarize("b")).not.toBeNull();
		store.clear();
		expect(store.summarize("b")).toBeNull();
	});

	it("works without an onUpdated listener", () => {
		const store = createFocusChainStore({ now: () => 0 });
		expect(() => store.applyStep("t", chain([{ id: "s", status: "in_progress" }]))).not.toThrow();
	});
});

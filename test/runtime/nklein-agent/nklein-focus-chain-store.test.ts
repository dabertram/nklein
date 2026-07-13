import { describe, expect, it, vi } from "vitest";
import type { FocusChain, FocusChainStep } from "../../../src/core/focus-chain";
import { createFocusChainStore } from "../../../src/nklein-agent/nklein-focus-chain-store";

const chain = (steps: Array<{ id?: string; text?: string; status: FocusChainStep["status"] }>): FocusChain => ({
	steps: steps.map((step) => ({ text: step.text ?? step.id ?? "step", status: step.status })),
	updatedAt: 1,
});

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

	it("attributes file and card touches to the active focus-chain step", () => {
		const onUpdated = vi.fn();
		const store = createFocusChainStore({ now: () => 1000, onUpdated });

		store.applyStep(
			"t1",
			chain([
				{ text: "Inspect context", status: "pending" },
				{ text: "Edit files", status: "in_progress" },
			]),
		);
		store.applyTouches("t1", { files: ["src/a.ts"], cardIds: ["card-1"] });

		const latest = onUpdated.mock.calls.at(-1)?.[1] as FocusChain | undefined;
		expect(latest?.steps[0]?.touchedFiles).toBeUndefined();
		expect(latest?.steps[1]?.touchedFiles).toEqual(["src/a.ts"]);
		expect(latest?.steps[1]?.touchedCardIds).toEqual(["card-1"]);
	});

	it("carries touches across whole-chain re-emissions", () => {
		const onUpdated = vi.fn();
		const store = createFocusChainStore({ now: () => 1000, onUpdated });

		store.applyStep("t1", chain([{ text: "Edit files", status: "in_progress" }]));
		store.applyTouches("t1", { files: ["src/a.ts"], cardIds: ["card-1"] });
		store.applyStep("t1", chain([{ text: "Edit files", status: "done" }]));

		const latest = onUpdated.mock.calls.at(-1)?.[1] as FocusChain | undefined;
		expect(latest?.steps[0]?.status).toBe("done");
		expect(latest?.steps[0]?.touchedFiles).toEqual(["src/a.ts"]);
		expect(latest?.steps[0]?.touchedCardIds).toEqual(["card-1"]);
	});
});

describe("focus chain store seed (F1.5 rehydration)", () => {
	it("restores a persisted chain without notifying, never clobbers a live one, and get() exposes it", () => {
		const updates: string[] = [];
		const store = createFocusChainStore({ now: () => 1_000, onUpdated: (taskId) => void updates.push(taskId) });
		const persisted = {
			steps: [
				{
					text: "Step one",
					status: "done" as const,
					startedAt: 10,
					completedAt: 20,
					touchedFiles: [],
					touchedCardIds: [],
				},
				{ text: "Step two", status: "in_progress" as const, startedAt: 30, touchedFiles: [], touchedCardIds: [] },
			],
			updatedAt: 500,
		};
		store.seed("task-1", persisted);
		expect(updates).toEqual([]); // seeding never echoes onUpdated
		expect(store.get("task-1")?.steps.map((step) => step.text)).toEqual(["Step one", "Step two"]);
		// Persisted per-step timing survives the seed.
		expect(store.get("task-1")?.steps[0]?.completedAt).toBe(20);
		// A live chain is never clobbered by a late seed.
		store.applyStep("task-2", { steps: [{ text: "Live", status: "in_progress" }], updatedAt: 900 });
		store.seed("task-2", persisted);
		expect(store.get("task-2")?.steps.map((step) => step.text)).toEqual(["Live"]);
	});
});

describe("focus chain store repair guard (F1.5)", () => {
	it("rejects a destructive re-emit, keeps the prior chain, surfaces onRepaired, and never notifies", () => {
		const updates: string[] = [];
		const repairs: string[] = [];
		const store = createFocusChainStore({
			now: () => 1_000,
			onUpdated: (taskId) => void updates.push(taskId),
			onRepaired: (_taskId, reason) => void repairs.push(reason),
		});
		store.applyStep("task-1", {
			steps: [
				{ text: "Done step", status: "done" },
				{ text: "Active step", status: "in_progress" },
			],
			updatedAt: 1,
		});
		expect(updates).toEqual(["task-1"]);

		store.applyStep("task-1", { steps: [], updatedAt: 2 });
		expect(repairs).toHaveLength(1);
		expect(updates).toEqual(["task-1"]); // no second notify
		expect(store.get("task-1")?.steps.map((step) => step.text)).toEqual(["Done step", "Active step"]);
	});
});

describe("focus chain store transition hook (F1.5)", () => {
	it("emits per-step transitions for accepted updates only", () => {
		const transitions: string[] = [];
		const store = createFocusChainStore({
			now: () => 1_000,
			onTransitions: (_taskId, changes) => {
				transitions.push(...changes.map((change) => `${change.stepText}:${change.from ?? "new"}→${change.to}`));
			},
		});
		store.applyStep("task-1", { steps: [{ text: "A", status: "in_progress" }], updatedAt: 1 });
		store.applyStep("task-1", {
			steps: [
				{ text: "A", status: "done" },
				{ text: "B", status: "pending" },
			],
			updatedAt: 2,
		});
		// A destructive re-emit is rejected — no transitions for it.
		store.applyStep("task-1", { steps: [], updatedAt: 3 });
		expect(transitions).toEqual(["A:new→in_progress", "A:in_progress→done", "B:new→pending"]);
	});
});

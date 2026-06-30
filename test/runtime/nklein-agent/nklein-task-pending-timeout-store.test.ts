import { describe, expect, it } from "vitest";

import { TaskPendingTimeoutStore } from "../../../src/nklein-agent/nklein-task-pending-timeout-store";

describe("TaskPendingTimeoutStore", () => {
	it("records a reason+source and consumes them together", () => {
		const store = new TaskPendingTimeoutStore();
		store.record("t1", "stream inactivity timeout after 120s", "role_override");

		expect(store.consume("t1")).toEqual({
			reason: "stream inactivity timeout after 120s",
			source: "role_override",
		});
	});

	it("consume clears the entry — a second consume reads null", () => {
		const store = new TaskPendingTimeoutStore();
		store.record("t1", "conversation timeout after 600s", "global_config");

		expect(store.consume("t1").reason).toBe("conversation timeout after 600s");
		// Read-and-clear: the stash is gone after the first consume.
		expect(store.consume("t1")).toEqual({ reason: null, source: null });
	});

	it("reads absent tasks as null reason and null source", () => {
		const store = new TaskPendingTimeoutStore();
		expect(store.consume("never-set")).toEqual({ reason: null, source: null });
	});

	it("preserves a null source (a timeout with no configured source layer)", () => {
		const store = new TaskPendingTimeoutStore();
		store.record("t1", "tool execution timeout after 90s", null);
		expect(store.consume("t1")).toEqual({ reason: "tool execution timeout after 90s", source: null });
	});

	it("keeps per-task stashes independent", () => {
		const store = new TaskPendingTimeoutStore();
		store.record("t1", "stream inactivity timeout after 30s", "autonomous_default");
		store.record("t2", "conversation timeout after 300s", "global_config");

		expect(store.consume("t1")).toEqual({
			reason: "stream inactivity timeout after 30s",
			source: "autonomous_default",
		});
		// Consuming t1 leaves t2 untouched.
		expect(store.consume("t2")).toEqual({ reason: "conversation timeout after 300s", source: "global_config" });
	});

	it("a later record overwrites an unconsumed stash", () => {
		const store = new TaskPendingTimeoutStore();
		store.record("t1", "stream inactivity timeout after 30s", "autonomous_default");
		store.record("t1", "conversation timeout after 300s", "global_config");
		expect(store.consume("t1")).toEqual({ reason: "conversation timeout after 300s", source: "global_config" });
	});
});

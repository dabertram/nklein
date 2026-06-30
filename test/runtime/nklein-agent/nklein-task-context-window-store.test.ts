import { describe, expect, it } from "vitest";

import { TaskContextWindowStore } from "../../../src/nklein-agent/nklein-task-context-window-store";

describe("TaskContextWindowStore", () => {
	it("records and reads back a task's context window", () => {
		const store = new TaskContextWindowStore();
		store.set("t1", 40_000);
		expect(store.get("t1")).toBe(40_000);
	});

	it("defaults an unknown task to null", () => {
		const store = new TaskContextWindowStore();
		expect(store.get("missing")).toBeNull();
	});

	it("preserves an explicitly recorded null", () => {
		const store = new TaskContextWindowStore();
		store.set("t1", null);
		expect(store.get("t1")).toBeNull();
	});

	it("a later set overwrites the prior value", () => {
		const store = new TaskContextWindowStore();
		store.set("t1", 8_000);
		store.set("t1", 40_000);
		expect(store.get("t1")).toBe(40_000);
	});

	it("forget drops one task's value back to the default, leaving others intact", () => {
		const store = new TaskContextWindowStore();
		store.set("t1", 16_000);
		store.set("t2", 32_000);
		store.forget("t1");
		expect(store.get("t1")).toBeNull();
		expect(store.get("t2")).toBe(32_000);
	});

	it("clear drops every task's value", () => {
		const store = new TaskContextWindowStore();
		store.set("t1", 16_000);
		store.set("t2", 32_000);
		store.clear();
		expect(store.get("t1")).toBeNull();
		expect(store.get("t2")).toBeNull();
	});
});

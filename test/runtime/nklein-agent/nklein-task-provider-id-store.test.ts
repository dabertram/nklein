import { describe, expect, it } from "vitest";

import { TaskProviderIdStore } from "../../../src/nklein-agent/nklein-task-provider-id-store";

describe("TaskProviderIdStore", () => {
	it("caches and reads back a provider id", () => {
		const store = new TaskProviderIdStore();
		store.set("t1", "lmstudio");
		expect(store.get("t1")).toBe("lmstudio");
	});

	it("returns undefined (the raw value) for an uncached task — callers apply their own fallback", () => {
		const store = new TaskProviderIdStore();
		expect(store.get("missing")).toBeUndefined();
		// Mirrors the call sites: a truthy check (resolver) or `?? UNCONFIGURED_PROVIDER_ID` (snapshot).
		expect(store.get("missing") ?? "unconfigured").toBe("unconfigured");
	});

	it("a later set repopulates the cache (re-derive path)", () => {
		const store = new TaskProviderIdStore();
		store.set("t1", "lmstudio");
		store.set("t1", "ollama");
		expect(store.get("t1")).toBe("ollama");
	});

	it("forget drops one task's cache entry, leaving others intact", () => {
		const store = new TaskProviderIdStore();
		store.set("t1", "lmstudio");
		store.set("t2", "ollama");
		store.forget("t1");
		expect(store.get("t1")).toBeUndefined();
		expect(store.get("t2")).toBe("ollama");
	});

	it("clear drops every cached entry", () => {
		const store = new TaskProviderIdStore();
		store.set("t1", "lmstudio");
		store.set("t2", "ollama");
		store.clear();
		expect(store.get("t1")).toBeUndefined();
		expect(store.get("t2")).toBeUndefined();
	});
});

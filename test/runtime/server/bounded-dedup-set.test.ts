import { describe, expect, it } from "vitest";
import { createBoundedDedupSet } from "../../../src/server/bounded-dedup-set";

describe("createBoundedDedupSet (§5.U extraction)", () => {
	it("remembers keys and reports membership + size", () => {
		const set = createBoundedDedupSet(10);
		expect(set.has("a")).toBe(false);
		set.remember("a");
		expect(set.has("a")).toBe(true);
		expect(set.size()).toBe(1);
	});

	it("is idempotent — remembering the same key twice keeps size at 1", () => {
		const set = createBoundedDedupSet(10);
		set.remember("a");
		set.remember("a");
		expect(set.size()).toBe(1);
		expect(set.has("a")).toBe(true);
	});

	it("FIFO-evicts the oldest key once capacity is exceeded", () => {
		const set = createBoundedDedupSet(3);
		set.remember("a");
		set.remember("b");
		set.remember("c");
		expect(set.size()).toBe(3);
		set.remember("d"); // pushes past capacity → evicts "a"
		expect(set.size()).toBe(3);
		expect(set.has("a")).toBe(false);
		expect(set.has("b")).toBe(true);
		expect(set.has("d")).toBe(true);
	});

	it("re-remembering an existing key does not change eviction order (Set semantics)", () => {
		const set = createBoundedDedupSet(3);
		set.remember("a");
		set.remember("b");
		set.remember("c");
		set.remember("a"); // already present — no reinsertion, "a" stays oldest
		set.remember("d"); // evicts the oldest, which is still "a"
		expect(set.has("a")).toBe(false);
		expect(set.has("b")).toBe(true);
	});

	it("rejects a non-positive or non-integer capacity", () => {
		expect(() => createBoundedDedupSet(0)).toThrow(/positive integer/);
		expect(() => createBoundedDedupSet(-1)).toThrow(/positive integer/);
		expect(() => createBoundedDedupSet(2.5)).toThrow(/positive integer/);
	});
});

import { describe, expect, it } from "vitest";
import { majorityVote } from "../../../src/core/self-consistency";

describe("majorityVote", () => {
	it("finds a clear majority with string samples", () => {
		const result = majorityVote(["a", "a", "b"]);
		expect(result.winner).toBe("a");
		expect(result.count).toBe(2);
		expect(result.total).toBe(3);
		expect(result.agreement).toBe(2 / 3);
	});

	it("returns null and zero agreement for an empty array", () => {
		const result = majorityVote([]);
		expect(result.winner).toBeNull();
		expect(result.count).toBe(0);
		expect(result.total).toBe(0);
		expect(result.agreement).toBe(0);
	});

	it("breaks ties toward the first-seen group", () => {
		const result = majorityVote(["x", "y", "x", "y", "z"]);
		// Both "x" and "y" have count 2; "x" was seen first.
		expect(result.winner).toBe("x");
		expect(result.count).toBe(2);
		expect(result.total).toBe(5);
		expect(result.agreement).toBe(2 / 5);
	});

	it("uses a custom keyFn to group objects", () => {
		const samples = [
			{ id: 1, value: "a" },
			{ id: 1, value: "a" },
			{ id: 2, value: "b" },
		];
		const result = majorityVote(samples, (obj) => String(obj.id));
		expect(result.winner).toEqual({ id: 1, value: "a" });
		expect(result.count).toBe(2);
		expect(result.total).toBe(3);
		expect(result.agreement).toBe(2 / 3);
	});

	it("handles a single sample", () => {
		const result = majorityVote(["only"]);
		expect(result.winner).toBe("only");
		expect(result.count).toBe(1);
		expect(result.total).toBe(1);
		expect(result.agreement).toBe(1);
	});
});

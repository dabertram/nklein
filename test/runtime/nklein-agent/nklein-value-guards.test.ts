import { describe, expect, it } from "vitest";
import { asRecord } from "../../../src/nklein-agent/nklein-value-guards";

describe("asRecord", () => {
	it("returns a plain object typed as a record", () => {
		const value = { a: 1 };
		expect(asRecord(value)).toBe(value);
		expect(asRecord({})).toEqual({});
	});

	it("rejects arrays, null, and primitives", () => {
		expect(asRecord([1, 2])).toBeNull();
		expect(asRecord(null)).toBeNull();
		expect(asRecord(undefined)).toBeNull();
		expect(asRecord("str")).toBeNull();
		expect(asRecord(42)).toBeNull();
		expect(asRecord(true)).toBeNull();
	});
});

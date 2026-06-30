import { describe, expect, it } from "vitest";

import {
	assignChangedConfigField,
	hasOwnKey,
	keepNormalizedValue,
	keepUpdatedValue,
	normalizeShortcutLabel,
	normalizeWorkspaceBaseDir,
} from "../../../src/config/runtime-config-value-helpers";

describe("keepUpdatedValue", () => {
	it("keeps the current value when the update is undefined", () => {
		expect(keepUpdatedValue(undefined, "current")).toBe("current");
	});

	it("takes the update value when provided — including an explicit null (undefined is the only sentinel)", () => {
		expect(keepUpdatedValue("next", "current")).toBe("next");
		expect(keepUpdatedValue(null, "current")).toBeNull();
	});
});

describe("keepNormalizedValue", () => {
	it("keeps the current value (without calling normalize) when the update is undefined", () => {
		let called = false;
		const result = keepNormalizedValue<number, number>(undefined, 5, (v) => {
			called = true;
			return v * 2;
		});
		expect(result).toBe(5);
		expect(called).toBe(false);
	});

	it("runs normalize on an explicitly-provided update value", () => {
		expect(keepNormalizedValue<number, number>(3, 5, (v) => v * 2)).toBe(6);
	});
});

describe("normalizeShortcutLabel / normalizeWorkspaceBaseDir", () => {
	for (const [name, fn] of [
		["normalizeShortcutLabel", normalizeShortcutLabel],
		["normalizeWorkspaceBaseDir", normalizeWorkspaceBaseDir],
	] as const) {
		it(`${name} trims to a non-empty string or null`, () => {
			expect(fn("  hello  ")).toBe("hello");
			expect(fn("   ")).toBeNull();
			expect(fn("")).toBeNull();
			expect(fn(42)).toBeNull();
			expect(fn(null)).toBeNull();
			expect(fn(undefined)).toBeNull();
		});
	}
});

describe("hasOwnKey", () => {
	it("is true only for a non-null object that owns the key", () => {
		expect(hasOwnKey({ a: 1 }, "a")).toBe(true);
		expect(hasOwnKey({ a: 1 } as { a: number; b?: number }, "b")).toBe(false);
		expect(hasOwnKey<{ a: number }>(null, "a")).toBe(false);
	});
});

describe("assignChangedConfigField", () => {
	// Exercise the branching generically (the function only reads hasOwnKey + the value/default comparison).
	const assign = assignChangedConfigField as unknown as (
		payload: Record<string, unknown>,
		existing: Record<string, unknown> | null,
		key: string,
		value: unknown,
		defaultValue: unknown,
	) => void;

	it("skips a default-valued field the existing file did not carry", () => {
		const payload: Record<string, unknown> = {};
		assign(payload, null, "x", 5, 5);
		expect("x" in payload).toBe(false);
	});

	it("writes a field that differs from its default", () => {
		const payload: Record<string, unknown> = {};
		assign(payload, null, "x", 7, 5);
		expect(payload.x).toBe(7);
	});

	it("writes a default-valued field the existing file already carried (explicit value survives)", () => {
		const payload: Record<string, unknown> = {};
		assign(payload, { x: 5 }, "x", 5, 5);
		expect(payload.x).toBe(5);
	});
});

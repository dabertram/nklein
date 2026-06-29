import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LocalStorageKey } from "@/storage/local-storage-store";
import {
	clampAtLeast,
	clampBetween,
	clampWidthToContainer,
	readOptionalPersistedResizeNumber,
	readPersistedResizeNumber,
	writePersistedResizeNumber,
} from "./resize-persistence";

const KEY = LocalStorageKey.ChatSidebarWidth;

describe("clamp helpers", () => {
	it("clampBetween bounds to [min,max], with optional rounding", () => {
		expect(clampBetween(5, 0, 10)).toBe(5);
		expect(clampBetween(-3, 0, 10)).toBe(0);
		expect(clampBetween(99, 0, 10)).toBe(10);
		expect(clampBetween(5.6, 0, 10, true)).toBe(6);
	});
	it("clampAtLeast enforces a lower bound, with optional rounding", () => {
		expect(clampAtLeast(8, 4)).toBe(8);
		expect(clampAtLeast(2, 4)).toBe(4);
		expect(clampAtLeast(7.4, 0, true)).toBe(7);
	});
	it("clampWidthToContainer clamps to [minWidth, containerWidth-reservedWidth] (rounded)", () => {
		expect(clampWidthToContainer({ width: 500, minWidth: 100, containerWidth: 800, reservedWidth: 200 })).toBe(500);
		expect(clampWidthToContainer({ width: 750.6, minWidth: 100, containerWidth: 800, reservedWidth: 200 })).toBe(600);
		expect(clampWidthToContainer({ width: 50, minWidth: 100, containerWidth: 800, reservedWidth: 200 })).toBe(100);
	});
});

describe("persisted resize numbers", () => {
	beforeEach(() => window.localStorage.clear());
	afterEach(() => window.localStorage.clear());

	it("readPersistedResizeNumber returns the fallback when absent or non-numeric, else the parsed (normalized) value", () => {
		expect(readPersistedResizeNumber({ key: KEY, fallback: 42 })).toBe(42);
		window.localStorage.setItem(KEY, "not-a-number");
		expect(readPersistedResizeNumber({ key: KEY, fallback: 42 })).toBe(42);
		window.localStorage.setItem(KEY, "150");
		expect(readPersistedResizeNumber({ key: KEY, fallback: 42 })).toBe(150);
		expect(readPersistedResizeNumber({ key: KEY, fallback: 42, normalize: (v) => v * 2 })).toBe(300);
	});

	it("readOptionalPersistedResizeNumber returns undefined when absent/non-numeric", () => {
		expect(readOptionalPersistedResizeNumber({ key: KEY })).toBeUndefined();
		window.localStorage.setItem(KEY, "bad");
		expect(readOptionalPersistedResizeNumber({ key: KEY })).toBeUndefined();
		window.localStorage.setItem(KEY, "12.5");
		expect(readOptionalPersistedResizeNumber({ key: KEY })).toBe(12.5);
	});

	it("writePersistedResizeNumber normalizes, persists, and returns the value (round-trips)", () => {
		const written = writePersistedResizeNumber({ key: KEY, value: 199.7, normalize: Math.round });
		expect(written).toBe(200);
		expect(readPersistedResizeNumber({ key: KEY, fallback: 0 })).toBe(200);
	});
});

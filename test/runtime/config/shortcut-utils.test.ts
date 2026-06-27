import { describe, expect, it } from "vitest";
import { areRuntimeProjectShortcutsEqual } from "../../../src/config/shortcut-utils";
import type { RuntimeProjectShortcut } from "../../../src/core/api-contract";

const a: RuntimeProjectShortcut = { label: "Build", command: "npm run build", icon: "hammer" };
const b: RuntimeProjectShortcut = { label: "Test", command: "npm test" };

describe("areRuntimeProjectShortcutsEqual", () => {
	it("is true for identical lists (including absent vs empty icon)", () => {
		expect(areRuntimeProjectShortcutsEqual([a, b], [a, b])).toBe(true);
		expect(areRuntimeProjectShortcutsEqual([{ ...b, icon: undefined }], [{ ...b, icon: "" }])).toBe(true);
		expect(areRuntimeProjectShortcutsEqual([], [])).toBe(true);
	});

	it("is false when length or any field differs", () => {
		expect(areRuntimeProjectShortcutsEqual([a], [a, b])).toBe(false);
		expect(areRuntimeProjectShortcutsEqual([a], [{ ...a, label: "Compile" }])).toBe(false);
		expect(areRuntimeProjectShortcutsEqual([a], [{ ...a, command: "make" }])).toBe(false);
		expect(areRuntimeProjectShortcutsEqual([a], [{ ...a, icon: "wrench" }])).toBe(false);
	});
});

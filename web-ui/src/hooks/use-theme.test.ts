import { beforeEach, describe, expect, it } from "vitest";
import { getTerminalThemeColors, isThemeId, readStoredThemeId, THEMES } from "@/hooks/use-theme";
import { LocalStorageKey } from "@/storage/local-storage-store";

describe("isThemeId", () => {
	it("accepts every id in the theme registry", () => {
		for (const theme of THEMES) {
			expect(isThemeId(theme.id)).toBe(true);
		}
	});

	it("rejects null, empty, unknown, and wrong-case strings", () => {
		expect(isThemeId(null)).toBe(false);
		expect(isThemeId("")).toBe(false);
		expect(isThemeId("not-a-theme")).toBe(false);
		expect(isThemeId("KLEIN")).toBe(false); // case-sensitive
	});
});

describe("readStoredThemeId (validates untrusted localStorage, falls back to the §5.AX default)", () => {
	beforeEach(() => {
		window.localStorage.clear();
	});

	it("defaults to `klein` when nothing is stored (and the default is itself a valid theme id)", () => {
		expect(readStoredThemeId()).toBe("klein");
		expect(isThemeId("klein")).toBe(true);
	});

	it("falls back to `klein` when the stored value is garbage (never trusts an invalid theme)", () => {
		window.localStorage.setItem(LocalStorageKey.Theme, "../../etc/passwd");
		expect(readStoredThemeId()).toBe("klein");
	});

	it("returns a stored, valid theme id verbatim", () => {
		window.localStorage.setItem(LocalStorageKey.Theme, "midnight");
		expect(readStoredThemeId()).toBe("midnight");
	});
});

describe("getTerminalThemeColors", () => {
	it("resolves a defined terminal palette for EVERY registered theme (registry ↔ palette in sync)", () => {
		for (const theme of THEMES) {
			const colors = getTerminalThemeColors(theme.id);
			expect(colors).toBeDefined();
			expect(typeof colors).toBe("object");
		}
	});

	it("returns the same theme's palette for an explicit id (stable lookup)", () => {
		expect(getTerminalThemeColors("klein")).toBe(getTerminalThemeColors("klein"));
		expect(getTerminalThemeColors("light")).not.toBe(getTerminalThemeColors("midnight"));
	});
});

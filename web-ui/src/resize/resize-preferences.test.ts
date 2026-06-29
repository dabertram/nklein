import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LocalStorageKey } from "@/storage/local-storage-store";
import {
	getResizePreferenceDefaultValue,
	loadBooleanResizePreference,
	loadResizePreference,
	persistBooleanResizePreference,
	persistResizePreference,
} from "./resize-preferences";

const NUM_KEY = LocalStorageKey.ChatSidebarWidth;
const BOOL_KEY = LocalStorageKey.ChatSidebarCollapsed;

describe("getResizePreferenceDefaultValue", () => {
	it("resolves a static or function default", () => {
		expect(getResizePreferenceDefaultValue({ key: NUM_KEY, defaultValue: 320 })).toBe(320);
		expect(getResizePreferenceDefaultValue({ key: NUM_KEY, defaultValue: () => 256 })).toBe(256);
	});
});

describe("number resize preference", () => {
	beforeEach(() => window.localStorage.clear());
	afterEach(() => window.localStorage.clear());

	it("loads the default when absent, then the persisted (normalized) value", () => {
		const pref = { key: NUM_KEY, defaultValue: 300, normalize: (v: number) => Math.round(v) } as const;
		expect(loadResizePreference(pref)).toBe(300);
		expect(persistResizePreference(pref, 199.6)).toBe(200);
		expect(loadResizePreference(pref)).toBe(200);
	});
});

describe("boolean resize preference", () => {
	beforeEach(() => window.localStorage.clear());
	afterEach(() => window.localStorage.clear());

	it("returns the default when absent, parses only 'true' as true, and round-trips", () => {
		expect(loadBooleanResizePreference({ key: BOOL_KEY, defaultValue: true })).toBe(true);
		window.localStorage.setItem(BOOL_KEY, "false");
		expect(loadBooleanResizePreference({ key: BOOL_KEY, defaultValue: true })).toBe(false);
		window.localStorage.setItem(BOOL_KEY, "garbage");
		expect(loadBooleanResizePreference({ key: BOOL_KEY, defaultValue: true })).toBe(false);
		expect(persistBooleanResizePreference({ key: BOOL_KEY, defaultValue: false }, true)).toBe(true);
		expect(loadBooleanResizePreference({ key: BOOL_KEY, defaultValue: false })).toBe(true);
	});
});

import { Play, Settings, Terminal } from "lucide-react";
import { describe, expect, it } from "vitest";
import {
	getRuntimeShortcutIconComponent,
	getRuntimeShortcutPickerOption,
	RUNTIME_SHORTCUT_ICON_OPTIONS,
} from "./runtime-shortcut-icons";

describe("RUNTIME_SHORTCUT_ICON_OPTIONS", () => {
	it("lists the 8 picker icons with value + label", () => {
		expect(RUNTIME_SHORTCUT_ICON_OPTIONS.map((o) => o.value)).toEqual([
			"play",
			"console",
			"bug",
			"download",
			"upload",
			"build",
			"code",
			"rocket",
		]);
		expect(RUNTIME_SHORTCUT_ICON_OPTIONS.every((o) => typeof o.label === "string" && o.label.length > 0)).toBe(true);
	});
});

describe("getRuntimeShortcutIconComponent", () => {
	it("resolves a known id, an alias, the cog→settings alias, and defaults unknown/absent to Terminal", () => {
		expect(getRuntimeShortcutIconComponent("play")).toBe(Play);
		expect(getRuntimeShortcutIconComponent("terminal")).toBe(Terminal); // alias → console
		expect(getRuntimeShortcutIconComponent("cog")).toBe(Settings); // alias → settings
		expect(getRuntimeShortcutIconComponent("nonsense")).toBe(Terminal); // default console
		expect(getRuntimeShortcutIconComponent(undefined)).toBe(Terminal);
		expect(getRuntimeShortcutIconComponent("  PLAY ")).toBe(Play); // trimmed + lowercased
	});
});

describe("getRuntimeShortcutPickerOption", () => {
	it("returns the picker option for a picker icon, mapping aliases", () => {
		expect(getRuntimeShortcutPickerOption("play")).toEqual({ value: "play", label: "Play" });
		expect(getRuntimeShortcutPickerOption("terminal")).toEqual({ value: "console", label: "Terminal" });
	});
	it("falls back to the default option for non-picker icons (settings/plus) and unknown/absent", () => {
		const def = { value: "console", label: "Terminal" };
		expect(getRuntimeShortcutPickerOption("settings")).toEqual(def);
		expect(getRuntimeShortcutPickerOption("plus")).toEqual(def);
		expect(getRuntimeShortcutPickerOption("nonsense")).toEqual(def);
		expect(getRuntimeShortcutPickerOption(undefined)).toEqual(def);
	});
});

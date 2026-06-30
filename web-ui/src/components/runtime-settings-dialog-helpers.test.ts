import { describe, expect, it } from "vitest";
import type { RuntimeProjectShortcut } from "@/runtime/types";
import {
	getNextShortcutLabel,
	normalizeAgentTimeoutProfile,
	normalizeTemplateForComparison,
} from "./runtime-settings-dialog-helpers";

function shortcut(label: string): RuntimeProjectShortcut {
	return { label } as RuntimeProjectShortcut;
}

describe("normalizeTemplateForComparison", () => {
	it("converts CRLF to LF and trims surrounding whitespace", () => {
		expect(normalizeTemplateForComparison("  a\r\nb \r\n")).toBe("a\nb");
	});
});

describe("getNextShortcutLabel", () => {
	it("returns the base label when it is free", () => {
		expect(getNextShortcutLabel([], "Build")).toBe("Build");
		expect(getNextShortcutLabel([shortcut("Test")], "Build")).toBe("Build");
	});

	it("suffixes the next free integer when the base is taken (case-insensitive)", () => {
		expect(getNextShortcutLabel([shortcut("build")], "Build")).toBe("Build 2");
		expect(getNextShortcutLabel([shortcut("Build"), shortcut("Build 2")], "Build")).toBe("Build 3");
	});

	it("does not treat blank existing labels as taken", () => {
		expect(getNextShortcutLabel([shortcut("   ")], "Build")).toBe("Build");
	});
});

describe("normalizeAgentTimeoutProfile", () => {
	it("keeps 'custom' regardless of cloud support", () => {
		expect(normalizeAgentTimeoutProfile("custom", true)).toBe("custom");
		expect(normalizeAgentTimeoutProfile("custom", false)).toBe("custom");
	});

	it("downgrades 'cloud' to 'local' only when cloud support is disabled", () => {
		expect(normalizeAgentTimeoutProfile("cloud", true)).toBe("cloud");
		expect(normalizeAgentTimeoutProfile("cloud", false)).toBe("local");
	});

	it("defaults 'local' / unknown / nullish to 'local'", () => {
		expect(normalizeAgentTimeoutProfile("local", true)).toBe("local");
		expect(normalizeAgentTimeoutProfile(null, true)).toBe("local");
		expect(normalizeAgentTimeoutProfile(undefined, true)).toBe("local");
	});
});

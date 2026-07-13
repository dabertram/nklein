import { describe, expect, it } from "vitest";
import { getOpenTargetOption, getOpenTargetOptions } from "@/utils/open-targets";

describe("open-targets", () => {
	it("filters unsupported options on windows", () => {
		const windowsOptions = getOpenTargetOptions("windows");
		expect(windowsOptions.some((option) => option.id === "iterm2")).toBe(false);
		expect(windowsOptions.some((option) => option.id === "xcode")).toBe(false);
		expect(windowsOptions.some((option) => option.id === "vscode-insiders")).toBe(true);
		expect(windowsOptions.some((option) => option.id === "finder")).toBe(true);
	});

	it("places VS Code Insiders as second from bottom on macOS", () => {
		const macOptions = getOpenTargetOptions("mac");
		expect(macOptions.at(-2)?.id).toBe("vscode-insiders");
	});

	it("falls back to default option when selected target is unsupported on platform", () => {
		const selected = getOpenTargetOption("iterm2", "linux");
		expect(selected.id).toBe("vscode");
	});
});

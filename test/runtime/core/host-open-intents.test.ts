import { describe, expect, it } from "vitest";
import {
	buildHostOpenCommand,
	hostOpenPlatformFromProcess,
	isHostOpenTargetId,
	validateHostOpenFilePath,
} from "../../../src/core/host-open-intents";

/**
 * F2.6 — typed host-open intents: the server-side command builder (cases ported from the retired web-ui
 * builder's tests — behavior preserved verbatim) and the openFile path validation gate.
 */

describe("buildHostOpenCommand (ported from the web-ui builder)", () => {
	it("builds a macOS app-open command", () => {
		expect(buildHostOpenCommand("vscode", "/tmp/repo", "mac")).toBe("open -a 'Visual Studio Code' '/tmp/repo'");
	});
	it("builds a linux file manager command", () => {
		expect(buildHostOpenCommand("finder", "/tmp/my repo", "linux")).toBe("xdg-open '/tmp/my repo'");
	});
	it("builds a macOS VS Code Insiders command", () => {
		expect(buildHostOpenCommand("vscode-insiders", "/tmp/repo", "mac")).toBe(
			"open -a 'Visual Studio Code - Insiders' '/tmp/repo'",
		);
	});
	it("builds a windows file explorer command", () => {
		expect(buildHostOpenCommand("finder", "C:\\Users\\dev\\my repo", "windows")).toBe(
			'explorer "C:\\Users\\dev\\my repo"',
		);
	});
	it("builds a windows VS Code Insiders command", () => {
		expect(buildHostOpenCommand("vscode-insiders", "C:\\Users\\dev\\my repo", "windows")).toBe(
			'code-insiders "C:\\Users\\dev\\my repo"',
		);
	});
	it("falls back to the platform default when the target is unsupported (windows iterm2)", () => {
		expect(buildHostOpenCommand("iterm2", "C:\\Users\\dev\\my repo", "windows")).toBe(
			'code "C:\\Users\\dev\\my repo"',
		);
	});
	it("shell-quotes hostile paths (single quotes cannot escape)", () => {
		expect(buildHostOpenCommand("finder", "/tmp/x'; rm -rf /; '", "linux")).toBe(
			"xdg-open '/tmp/x'\"'\"'; rm -rf /; '\"'\"''",
		);
	});
});

describe("hostOpenPlatformFromProcess + target id guard", () => {
	it("maps process.platform values and validates ids", () => {
		expect(hostOpenPlatformFromProcess("darwin")).toBe("mac");
		expect(hostOpenPlatformFromProcess("win32")).toBe("windows");
		expect(hostOpenPlatformFromProcess("linux")).toBe("linux");
		expect(hostOpenPlatformFromProcess("freebsd")).toBe("other");
		expect(isHostOpenTargetId("vscode")).toBe(true);
		expect(isHostOpenTargetId("bash -c evil")).toBe(false);
	});
});

describe("validateHostOpenFilePath", () => {
	it("accepts absolute plain paths and rejects URLs/relative/empty", () => {
		expect(validateHostOpenFilePath("/tmp/plan.md")).toEqual({ ok: true, path: "/tmp/plan.md" });
		expect(validateHostOpenFilePath("https://evil.example.com").ok).toBe(false);
		expect(validateHostOpenFilePath("file:///etc/passwd").ok).toBe(false);
		expect(validateHostOpenFilePath("relative/x.txt").ok).toBe(false);
		expect(validateHostOpenFilePath("   ").ok).toBe(false);
	});
});

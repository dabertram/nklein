import { describe, expect, it } from "vitest";

import { parseCliPortValue, shouldAutoOpenBrowserTabForInvocation } from "../../src/cli-invocation-parsing";

describe("parseCliPortValue", () => {
	it("returns auto mode for 'auto' (case- and space-insensitive)", () => {
		expect(parseCliPortValue("auto")).toEqual({ mode: "auto" });
		expect(parseCliPortValue("  AUTO ")).toEqual({ mode: "auto" });
	});

	it("returns fixed mode for a valid port", () => {
		expect(parseCliPortValue("3484")).toEqual({ mode: "fixed", value: 3484 });
	});

	it("throws on a missing/blank value", () => {
		expect(() => parseCliPortValue("")).toThrow(/Missing value for --port/);
		expect(() => parseCliPortValue("   ")).toThrow(/Missing value for --port/);
	});

	it("throws a helpful error for an out-of-range or non-numeric port", () => {
		expect(() => parseCliPortValue("0")).toThrow(/Invalid port value/);
		expect(() => parseCliPortValue("70000")).toThrow(/Invalid port value/);
		expect(() => parseCliPortValue("nope")).toThrow(/Invalid port value/);
	});
});

describe("shouldAutoOpenBrowserTabForInvocation", () => {
	it("auto-opens for a bare invocation", () => {
		expect(shouldAutoOpenBrowserTabForInvocation([])).toBe(true);
	});

	it("auto-opens for known launch flags", () => {
		expect(shouldAutoOpenBrowserTabForInvocation(["--open"])).toBe(true);
		expect(shouldAutoOpenBrowserTabForInvocation(["--https", "--no-passcode"])).toBe(true);
	});

	it("auto-opens for launch options carrying a value (space or = form)", () => {
		expect(shouldAutoOpenBrowserTabForInvocation(["--port", "3484"])).toBe(true);
		expect(shouldAutoOpenBrowserTabForInvocation(["--port=3484"])).toBe(true);
		expect(shouldAutoOpenBrowserTabForInvocation(["--agent", "codex", "--https"])).toBe(true);
	});

	it("classifies the desktop LAN-serving spawn as a launch (§ desktop app #2 regression)", () => {
		// --public-host was missing from the classifier when the flag was added, which made the
		// server EXIT right after startup on any LAN invocation (the post-parse process.exit path).
		expect(
			shouldAutoOpenBrowserTabForInvocation([
				"--no-open",
				"--port",
				"3484",
				"--host",
				"0.0.0.0",
				"--public-host",
				"192.168.1.42",
				"--insecure-remote-http",
			]),
		).toBe(true);
	});

	it("does NOT auto-open for a subcommand or positional", () => {
		expect(shouldAutoOpenBrowserTabForInvocation(["task"])).toBe(false);
		expect(shouldAutoOpenBrowserTabForInvocation(["--open", "dev"])).toBe(false);
	});

	it("does NOT auto-open for an unknown option", () => {
		expect(shouldAutoOpenBrowserTabForInvocation(["--frobnicate"])).toBe(false);
	});

	it("does NOT auto-open when a value-taking option is missing its value", () => {
		expect(shouldAutoOpenBrowserTabForInvocation(["--port"])).toBe(false);
	});
});

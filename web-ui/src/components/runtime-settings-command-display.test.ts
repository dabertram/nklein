import { describe, expect, it } from "vitest";
import { buildDisplayedAgentCommand, quoteCommandPartForDisplay } from "@/components/runtime-settings-command-display";

describe("quoteCommandPartForDisplay", () => {
	it("leaves shell-safe parts unquoted (flags, paths, and the allowed punctuation set)", () => {
		for (const safe of [
			"codex",
			"--dangerously-skip-permissions",
			"/usr/bin/agent",
			"a=b,c",
			"user@host",
			"50%",
			"a+b",
			"x.y-z_1:2/3",
		]) {
			expect(quoteCommandPartForDisplay(safe)).toBe(safe);
		}
	});

	it("JSON-quotes any part containing a character outside the safe set", () => {
		expect(quoteCommandPartForDisplay("hello world")).toBe('"hello world"'); // space
		expect(quoteCommandPartForDisplay("a;b")).toBe('"a;b"'); // semicolon (command separator)
		expect(quoteCommandPartForDisplay("$(rm -rf /)")).toBe('"$(rm -rf /)"'); // substitution chars
		expect(quoteCommandPartForDisplay('a"b')).toBe('"a\\"b"'); // embedded quote is escaped
	});

	it("quotes the empty string (it has no safe chars to match)", () => {
		expect(quoteCommandPartForDisplay("")).toBe('""');
	});
});

describe("buildDisplayedAgentCommand", () => {
	it("shows nothing for the built-in !Klein agent (no external launch command)", () => {
		expect(buildDisplayedAgentCommand("nklein", "nklein", false)).toBe("");
		expect(buildDisplayedAgentCommand("nklein", "nklein", true)).toBe("");
	});

	it("shows only the binary when autonomous mode is OFF (no auto flags)", () => {
		expect(buildDisplayedAgentCommand("codex", "codex", false)).toBe("codex");
	});

	it("appends the agent's autonomous args when autonomous mode is ON", () => {
		// The dangerous auto-flag must be visible to the user in the displayed command.
		expect(buildDisplayedAgentCommand("codex", "codex", true)).toBe(
			"codex --dangerously-bypass-approvals-and-sandbox",
		);
	});

	it("joins multiple autonomous args (space-separated)", () => {
		expect(buildDisplayedAgentCommand("droid", "droid", true)).toBe("droid --auto high");
	});

	it("shows just the binary for an autonomous agent that declares no auto args", () => {
		expect(buildDisplayedAgentCommand("opencode", "opencode", true)).toBe("opencode");
	});
});

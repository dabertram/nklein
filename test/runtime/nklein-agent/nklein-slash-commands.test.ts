import { describe, expect, it } from "vitest";
import {
	isNKleinClearSlashCommand,
	NKLEIN_BUILTIN_SLASH_COMMANDS,
} from "../../../src/nklein-agent/nklein-slash-commands";

describe("isNKleinClearSlashCommand", () => {
	it("matches a lone /clear, trimming and case-folding", () => {
		expect(isNKleinClearSlashCommand("/clear")).toBe(true);
		expect(isNKleinClearSlashCommand("  /clear  ")).toBe(true);
		expect(isNKleinClearSlashCommand("/CLEAR")).toBe(true);
	});

	it("does not match when there is extra text, a different command, or no slash", () => {
		expect(isNKleinClearSlashCommand("/clear the board")).toBe(false); // trailing text → not a lone command
		expect(isNKleinClearSlashCommand("/clearall")).toBe(false);
		expect(isNKleinClearSlashCommand("clear")).toBe(false);
		expect(isNKleinClearSlashCommand("please /clear")).toBe(false);
		expect(isNKleinClearSlashCommand("")).toBe(false);
	});
});

describe("NKLEIN_BUILTIN_SLASH_COMMANDS", () => {
	it("advertises the clear command", () => {
		expect(NKLEIN_BUILTIN_SLASH_COMMANDS.some((c) => c.name === "clear")).toBe(true);
	});
});

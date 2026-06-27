import { describe, expect, it } from "vitest";
import { deriveTaskTitleFromPrompt, resolveTaskTitle } from "../../../src/core/task-title";

describe("deriveTaskTitleFromPrompt", () => {
	it("takes the first non-empty line, skipping leading blank lines", () => {
		expect(deriveTaskTitleFromPrompt("\n\n   \nBuild a widget\nmore detail")).toBe("Build a widget");
	});

	it("returns an empty string for an empty / whitespace-only prompt", () => {
		expect(deriveTaskTitleFromPrompt("")).toBe("");
		expect(deriveTaskTitleFromPrompt("   \n\t\n  ")).toBe("");
	});

	it('strips a wrapping XML/HTML tag like <user_input mode="act">…</user_input>', () => {
		expect(deriveTaskTitleFromPrompt('<user_input mode="act">Add login</user_input>')).toBe("Add login");
	});

	it("collapses internal whitespace", () => {
		expect(deriveTaskTitleFromPrompt("Build    the\t\twidget")).toBe("Build the widget");
	});

	it("extracts the first sentence when there is sentence punctuation", () => {
		expect(deriveTaskTitleFromPrompt("First sentence here. Second sentence.")).toBe("First sentence here.");
		expect(deriveTaskTitleFromPrompt("Hi! Bye.")).toBe("Hi!");
	});

	it("uses the whole line when there is no sentence punctuation", () => {
		expect(deriveTaskTitleFromPrompt("No punctuation just words")).toBe("No punctuation just words");
	});

	it("truncates to maxChars with an ellipsis", () => {
		const out = deriveTaskTitleFromPrompt("aaaaaaaaaaaaaaaaaaaa", 5);
		expect(out).toBe("aaaaa…");
	});

	it("does not truncate when the line fits within maxChars", () => {
		expect(deriveTaskTitleFromPrompt("short", 80)).toBe("short");
	});
});

describe("resolveTaskTitle", () => {
	it("prefers an explicit non-empty title", () => {
		expect(resolveTaskTitle("My Title", "some prompt")).toBe("My Title");
	});

	it("strips an outer <user_input> wrapper from the title", () => {
		expect(resolveTaskTitle("<user_input>Inner Title</user_input>", "prompt")).toBe("Inner Title");
	});

	it("falls back to deriving from the prompt when the title is only an empty wrapper tag", () => {
		expect(resolveTaskTitle("<user_input></user_input>", "Fallback prompt")).toBe("Fallback prompt");
	});

	it("derives from the prompt when the title is null / undefined / whitespace", () => {
		expect(resolveTaskTitle(null, "Derive me")).toBe("Derive me");
		expect(resolveTaskTitle(undefined, "Derive me")).toBe("Derive me");
		expect(resolveTaskTitle("   ", "Derive me. Extra.")).toBe("Derive me.");
	});
});

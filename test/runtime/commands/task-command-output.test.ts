import { afterEach, describe, expect, it, vi } from "vitest";
import { printJson, toErrorMessage } from "../../../src/commands/task/task-command-output";

describe("toErrorMessage", () => {
	it("uses an Error's message when non-empty, else stringifies", () => {
		expect(toErrorMessage(new Error("boom"))).toBe("boom");
		expect(toErrorMessage(new Error(""))).toBe("Error"); // empty message ⇒ String(error) === "Error"
		expect(toErrorMessage(new Error("   "))).toBe("Error:    "); // whitespace-only message isn't "non-empty" ⇒ String(error)
		expect(toErrorMessage("plain string")).toBe("plain string");
		expect(toErrorMessage(42)).toBe("42");
		expect(toErrorMessage(null)).toBe("null");
	});
});

describe("printJson", () => {
	afterEach(() => vi.restoreAllMocks());
	it("writes pretty-printed JSON followed by a newline to stdout", () => {
		const writes: string[] = [];
		vi.spyOn(process.stdout, "write").mockImplementation((chunk: string | Uint8Array) => {
			writes.push(String(chunk));
			return true;
		});
		printJson({ a: 1, b: ["x"] });
		expect(writes).toEqual([`${JSON.stringify({ a: 1, b: ["x"] }, null, 2)}\n`]);
	});
});

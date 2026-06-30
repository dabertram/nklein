import { describe, expect, it } from "vitest";

import {
	extractAgentErrorMessage,
	readMessagePartText,
	readToolResult,
} from "../../../src/nklein-agent/nklein-message-content-readers";

describe("readMessagePartText", () => {
	it("concatenates the text of parts matching the requested type", () => {
		const message = {
			content: [
				{ type: "text", text: "Hello " },
				{ type: "reasoning", text: "(thinking)" },
				{ type: "text", text: "world" },
			],
		};
		expect(readMessagePartText(message, "text")).toBe("Hello world");
		expect(readMessagePartText(message, "reasoning")).toBe("(thinking)");
	});

	it("returns null for non-array content, no matching parts, or malformed parts", () => {
		expect(readMessagePartText({ content: "nope" }, "text")).toBeNull();
		expect(readMessagePartText({ content: [{ type: "reasoning", text: "x" }] }, "text")).toBeNull();
		expect(readMessagePartText({ content: [{ type: "text" }] }, "text")).toBeNull();
		expect(readMessagePartText(null, "text")).toBeNull();
	});
});

describe("extractAgentErrorMessage", () => {
	it("reads a trimmed message from a string / Error / { message } shape", () => {
		expect(extractAgentErrorMessage("  boom  ")).toBe("boom");
		expect(extractAgentErrorMessage(new Error("failed"))).toBe("failed");
		expect(extractAgentErrorMessage({ message: "duck-typed" })).toBe("duck-typed");
	});

	it("returns null for empty messages and unrecognized shapes", () => {
		expect(extractAgentErrorMessage("   ")).toBeNull();
		expect(extractAgentErrorMessage(new Error("   "))).toBeNull();
		expect(extractAgentErrorMessage({ code: 1 })).toBeNull();
		expect(extractAgentErrorMessage(42)).toBeNull();
		expect(extractAgentErrorMessage(null)).toBeNull();
	});
});

describe("readToolResult", () => {
	const wrap = (part: unknown) => ({ content: [part] });

	it("returns empty output/error for missing/non-array content or no tool-result part", () => {
		expect(readToolResult({ content: "nope" })).toEqual({ output: undefined, error: null });
		expect(readToolResult(wrap({ type: "text", text: "x" }))).toEqual({ output: undefined, error: null });
	});

	it("returns the output with a null error for a successful tool-result", () => {
		expect(readToolResult(wrap({ type: "tool-result", output: { ok: true } }))).toEqual({
			output: { ok: true },
			error: null,
		});
	});

	it("extracts the error message for an errored tool-result, falling back to a generic message", () => {
		expect(readToolResult(wrap({ type: "tool-result", isError: true, output: "disk full" }))).toEqual({
			output: "disk full",
			error: "disk full",
		});
		expect(readToolResult(wrap({ type: "tool-result", isError: true, output: 42 }))).toEqual({
			output: 42,
			error: "Tool execution failed",
		});
	});
});

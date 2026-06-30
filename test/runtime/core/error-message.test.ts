import { describe, expect, it } from "vitest";

import { toErrorMessage } from "../../../src/core/error-message";

describe("toErrorMessage", () => {
	it("prefers a real Error's trimmed message", () => {
		expect(toErrorMessage(new Error("boom"))).toBe("boom");
		expect(toErrorMessage(new Error("  padded  "))).toBe("padded");
	});

	it("falls through an empty/whitespace Error message to the fallback (default String(error))", () => {
		expect(toErrorMessage(new Error(""))).toBe("Error");
		expect(toErrorMessage(new Error("   "))).toBe("Error:    ");
	});

	it("duck-types a non-Error object carrying a string `message`", () => {
		expect(toErrorMessage({ message: "from a plain object" })).toBe("from a plain object");
		expect(toErrorMessage({ message: "  trimmed  " })).toBe("trimmed");
	});

	it("stringifies primitives and null/undefined via the default fallback", () => {
		expect(toErrorMessage("plain string")).toBe("plain string");
		expect(toErrorMessage(42)).toBe("42");
		expect(toErrorMessage(null)).toBe("null");
		expect(toErrorMessage(undefined)).toBe("undefined");
	});

	it("uses an explicit fallback only when nothing better is found", () => {
		expect(toErrorMessage(new Error("real"), "friendly")).toBe("real");
		expect(toErrorMessage({ message: "obj" }, "friendly")).toBe("obj");
		expect(toErrorMessage(null, "An unexpected error occurred.")).toBe("An unexpected error occurred.");
		expect(toErrorMessage(new Error("  "), "Unknown error")).toBe("Unknown error");
		expect(toErrorMessage({ nope: true }, "Unknown error")).toBe("Unknown error");
	});
});

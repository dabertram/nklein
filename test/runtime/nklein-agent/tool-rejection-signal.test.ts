import { describe, expect, it } from "vitest";
import { isPreExecutionToolRejection } from "../../../src/nklein-agent/tool-rejection-signal";

describe("isPreExecutionToolRejection (§5.BD)", () => {
	it("matches the SDK's pre-execution rejection wrapper", () => {
		expect(
			isPreExecutionToolRejection(
				"Tool call read_files was rejected before execution: Invalid input for tool read_files: Type validation failed",
			),
		).toBe(true);
	});

	it("matches a bare Zod type-validation message", () => {
		expect(isPreExecutionToolRejection("Type validation failed: expected array, received string")).toBe(true);
	});

	it("does NOT count a normal in-execute tool failure (a blocked write / missing file)", () => {
		expect(isPreExecutionToolRejection("Blocked write_file: path is outside this card's declared file scope")).toBe(
			false,
		);
		expect(isPreExecutionToolRejection("ENOENT: no such file or directory")).toBe(false);
		expect(isPreExecutionToolRejection("Blocked read_files: this exact file content was already read")).toBe(false);
	});

	it("is false for null / empty", () => {
		expect(isPreExecutionToolRejection(null)).toBe(false);
		expect(isPreExecutionToolRejection(undefined)).toBe(false);
		expect(isPreExecutionToolRejection("")).toBe(false);
	});
});

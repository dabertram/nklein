import { describe, expect, it } from "vitest";
import {
	formatToolError,
	isRetryableToolError,
	type ToolErrorContract,
	toolErrorContractSchema,
} from "../../../src/core/tool-error-contract";

describe("toolErrorContractSchema", () => {
	it("parses a valid full error with all optional fields", () => {
		const input = {
			code: "INVALID_TYPE",
			field: "options.limit",
			expected: "positive integer ≤ 100",
			received: 'string "all"',
			retryable: true,
			minimalValidExample: '{"options":{"limit":10}}',
			hint: 'Pass a number, not a string, for "options.limit".',
		};
		const result = toolErrorContractSchema.parse(input);
		expect(result).toEqual(input);
	});

	it("parses a minimal error with only required fields", () => {
		const input = { code: "UNKNOWN_TOOL", retryable: false };
		const result = toolErrorContractSchema.parse(input);
		expect(result).toEqual(input);
	});

	it("rejects an error missing the required retryable field", () => {
		const input = { code: "MISSING_FIELD", field: "query" };
		expect(() => toolErrorContractSchema.parse(input)).toThrow();
	});
});

describe("formatToolError", () => {
	it("includes code, field, expected/received, hint, and example when all fields present", () => {
		const err: ToolErrorContract = {
			code: "MISSING_FIELD",
			field: "query",
			expected: "non-empty string",
			received: "undefined",
			retryable: true,
			minimalValidExample: '{"query":"find open bugs"}',
			hint: 'The "query" field is required.',
		};
		const msg = formatToolError(err);
		expect(msg).toContain("[MISSING_FIELD]");
		expect(msg).toContain('field="query"');
		expect(msg).toContain("expected non-empty string");
		expect(msg).toContain("got undefined");
		expect(msg).toContain('The "query" field is required.');
		expect(msg).toContain('example: {"query":"find open bugs"}');
		expect(msg).toContain("Retry: yes.");
	});

	it("omits absent optional fields (no spurious 'undefined' tokens)", () => {
		const err: ToolErrorContract = {
			code: "OUT_OF_RANGE",
			retryable: false,
		};
		const msg = formatToolError(err);
		expect(msg).toContain("[OUT_OF_RANGE]");
		expect(msg).toContain("Retry: no.");
		expect(msg).not.toContain("field=");
		expect(msg).not.toContain("expected");
		expect(msg).not.toContain("got");
		expect(msg).not.toContain("example:");
		expect(msg).not.toContain("undefined");
	});
});

describe("isRetryableToolError", () => {
	it("returns true when retryable is true", () => {
		const err: ToolErrorContract = { code: "MISSING_FIELD", retryable: true };
		expect(isRetryableToolError(err)).toBe(true);
	});

	it("returns false when retryable is false", () => {
		const err: ToolErrorContract = { code: "UNKNOWN_TOOL", retryable: false };
		expect(isRetryableToolError(err)).toBe(false);
	});
});

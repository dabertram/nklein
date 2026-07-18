import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
	formatToolError,
	isRetryableToolError,
	type ToolErrorContract,
	toolErrorContractSchema,
	toolErrorFromThrown,
	toolErrorFromZodError,
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

describe("toolErrorFromZodError (§5.O tool-arg rejection seam)", () => {
	const toolArgs = z
		.object({
			query: z.string(),
			limit: z.number().min(1).max(100),
			mode: z.enum(["fast", "thorough"]),
			options: z.object({ depth: z.number() }),
		})
		.strict();

	/** Reject `input` against the tool schema and return the guaranteed ZodError. */
	function reject(input: unknown): z.ZodError {
		const result = toolArgs.safeParse(input);
		if (result.success) {
			throw new Error("expected the input to be rejected");
		}
		return result.error;
	}

	it("a missing required field becomes MISSING_FIELD (ADD an arg), not INVALID_TYPE", () => {
		const err = toolErrorFromZodError(reject({ limit: 5, mode: "fast", options: { depth: 1 } }));
		expect(err.code).toBe("MISSING_FIELD");
		expect(err.field).toBe("query");
		expect(err.expected).toBe("string");
		expect(err.received).toBe("undefined");
		expect(err.retryable).toBe(true);
		expect(err.hint).toContain("expected string");
	});

	it("a wrong-typed field becomes INVALID_TYPE (FIX the arg) with the received type recovered", () => {
		const err = toolErrorFromZodError(reject({ query: 42, limit: 5, mode: "fast", options: { depth: 1 } }));
		expect(err.code).toBe("INVALID_TYPE");
		expect(err.field).toBe("query");
		expect(err.received).toBe("number");
	});

	it("an out-of-range number becomes OUT_OF_RANGE with the bound in `expected`", () => {
		const err = toolErrorFromZodError(reject({ query: "x", limit: 500, mode: "fast", options: { depth: 1 } }));
		expect(err.code).toBe("OUT_OF_RANGE");
		expect(err.field).toBe("limit");
		expect(err.expected).toContain("100");
	});

	it("a bad enum value becomes INVALID_VALUE listing the allowed options", () => {
		const err = toolErrorFromZodError(reject({ query: "x", limit: 5, mode: "medium", options: { depth: 1 } }));
		expect(err.code).toBe("INVALID_VALUE");
		expect(err.field).toBe("mode");
		expect(err.expected).toContain('"fast"');
		expect(err.expected).toContain('"thorough"');
	});

	it("an unrecognized key becomes UNRECOGNIZED_KEY (empty path → no `field`) with the key in `received`", () => {
		const err = toolErrorFromZodError(
			reject({ query: "x", limit: 5, mode: "fast", options: { depth: 1 }, extra: 1 }),
		);
		expect(err.code).toBe("UNRECOGNIZED_KEY");
		expect(err.field).toBeUndefined();
		expect(err.received).toBe("extra");
	});

	it("a nested field yields a dot-path `field`", () => {
		const err = toolErrorFromZodError(reject({ query: "x", limit: 5, mode: "fast", options: { depth: "deep" } }));
		expect(err.field).toBe("options.depth");
	});

	it("reports only the FIRST issue (small models repair one arg per turn)", () => {
		// query missing AND limit out of range AND mode bad — the contract carries a single field.
		const err = toolErrorFromZodError(reject({ limit: 999, mode: "nope", options: { depth: 1 } }));
		expect(err.field).toBe("query");
		expect(err.code).toBe("MISSING_FIELD");
	});

	it("passes a caller-supplied minimalValidExample through for the retry to copy", () => {
		const example = '{"query":"open bugs","limit":10,"mode":"fast","options":{"depth":1}}';
		const err = toolErrorFromZodError(reject({ limit: 5, mode: "fast", options: { depth: 1 } }), {
			minimalValidExample: example,
		});
		expect(err.minimalValidExample).toBe(example);
	});

	it("round-trips through the schema and formatter (a real end-to-end reject → message)", () => {
		const err = toolErrorFromZodError(reject({ limit: 5, mode: "fast", options: { depth: 1 } }));
		expect(() => toolErrorContractSchema.parse(err)).not.toThrow();
		const message = formatToolError(err);
		expect(message).toContain("[MISSING_FIELD]");
		expect(message).toContain('field="query"');
		expect(message).toContain("Retry: yes.");
	});
});

describe("toolErrorFromThrown (F3.T2 — non-Zod tool failures)", () => {
	it("classifies a timeout as retryable", () => {
		const err = toolErrorFromThrown(new Error("Request timed out after 30s"));
		expect(err).toMatchObject({ code: "TIMEOUT", retryable: true });
		expect(toolErrorContractSchema.parse(err)).toBeTruthy();
	});

	it("classifies an AbortError as NON-retryable (deliberate cancel)", () => {
		const abort = new Error("The operation was aborted");
		abort.name = "AbortError";
		expect(toolErrorFromThrown(abort)).toMatchObject({ code: "ABORTED", retryable: false });
	});

	it("classifies a JSON/parse failure as retryable malformed output", () => {
		expect(toolErrorFromThrown(new SyntaxError("Unexpected token < in JSON"))).toMatchObject({
			code: "MALFORMED_OUTPUT",
			retryable: true,
		});
	});

	it("classifies ENOENT / not-found as retryable with a path hint", () => {
		const err = toolErrorFromThrown(new Error("ENOENT: no such file or directory, open 'spec.md'"), {
			toolName: "read_files",
		});
		expect(err).toMatchObject({ code: "NOT_FOUND", retryable: true });
		expect(err.hint).toContain("read_files");
		expect(err.hint).toContain("workspace-relative");
	});

	it("classifies a network failure as retryable", () => {
		expect(toolErrorFromThrown(new Error("fetch failed: ECONNREFUSED"))).toMatchObject({
			code: "NETWORK",
			retryable: true,
		});
	});

	it("an unknown error is NON-retryable (never loop on a real bug) and surfaces the message", () => {
		const err = toolErrorFromThrown(new Error("something exploded internally"));
		expect(err).toMatchObject({ code: "TOOL_EXECUTION_ERROR", retryable: false });
		expect(err.hint).toContain("something exploded internally");
	});

	it("never throws on non-Error input (string / object / null)", () => {
		expect(toolErrorFromThrown("plain string boom").code).toBe("TOOL_EXECUTION_ERROR");
		expect(toolErrorFromThrown({ weird: true }).retryable).toBe(false);
		expect(() => toolErrorFromThrown(null)).not.toThrow();
	});
});
describe("MALFORMED_PATCH classification (F12.16)", () => {
	it("types an edit-apply failure on edit-ish tools and stays generic elsewhere", () => {
		const applyFail = toolErrorFromThrown(new Error("The provided old text was not found in src/a.ts."), {
			toolName: "edit_file",
		});
		expect(applyFail.code).toBe("MALFORMED_PATCH");
		expect(applyFail.retryable).toBe(true);
		const syntaxReject = toolErrorFromThrown(
			new Error("Blocked edit_file: the edit left the file broken (unbalanced brackets)."),
			{ toolName: "edit_file" },
		);
		expect(syntaxReject.code).toBe("MALFORMED_PATCH");
		// The same message WITHOUT an edit-ish tool stays out of the patch class.
		const other = toolErrorFromThrown(new Error("value not found in registry"), { toolName: "read_files" });
		expect(other.code).not.toBe("MALFORMED_PATCH");
	});
});

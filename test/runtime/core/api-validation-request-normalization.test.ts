import { describe, expect, it } from "vitest";
import {
	parseCommandRunRequest,
	parseNKleinModelContextWindowOverrideRequest,
	parseTaskChatSendRequest,
	parseWorktreeDeleteRequest,
} from "../../../src/core/api-validation";

// §5.V — these tRPC boundary parsers layer post-schema business rules (trim + emptiness + normalization) on top of the
// Zod schema; the trim-check is deliberately STRICTER than the schema (a whitespace value passes the schema but is
// rejected here). Characterizing that so a dropped trim / emptiness guard can't silently regress.

describe("parseCommandRunRequest (§5.V coverage)", () => {
	it("trims the command", () => {
		expect(parseCommandRunRequest({ command: "  ls -la  " })).toEqual({ command: "ls -la" });
	});

	it("rejects an empty / whitespace-only command", () => {
		expect(() => parseCommandRunRequest({ command: "   " })).toThrow(/Command cannot be empty/);
	});

	it("rejects a payload missing the command field (schema layer)", () => {
		expect(() => parseCommandRunRequest({})).toThrow();
	});
});

describe("parseTaskChatSendRequest (§5.V coverage)", () => {
	it("trims taskId + text on the happy path", () => {
		const req = parseTaskChatSendRequest({ taskId: "  t1  ", text: "  hello  " });
		expect(req.taskId).toBe("t1");
		expect(req.text).toBe("hello");
	});

	it("rejects a blank taskId", () => {
		expect(() => parseTaskChatSendRequest({ taskId: "   ", text: "hi" })).toThrow(/taskId cannot be empty/);
	});

	it("rejects a message with neither text nor images", () => {
		expect(() => parseTaskChatSendRequest({ taskId: "t1", text: "   " })).toThrow(/text or images are required/);
	});
});

describe("parseNKleinModelContextWindowOverrideRequest (§5.V coverage)", () => {
	it("trims provider/model, normalizes endpoint, and passes the context window through", () => {
		expect(
			parseNKleinModelContextWindowOverrideRequest({
				providerId: "  lmstudio  ",
				modelId: "  qwen  ",
				endpoint: "  http://localhost:1234  ",
				contextWindow: 8000,
			}),
		).toEqual({ providerId: "lmstudio", modelId: "qwen", endpoint: "http://localhost:1234", contextWindow: 8000 });
	});

	it("normalizes a blank / omitted endpoint to null and allows a null context window", () => {
		expect(
			parseNKleinModelContextWindowOverrideRequest({ providerId: "p", modelId: "m", contextWindow: null }),
		).toEqual({ providerId: "p", modelId: "m", endpoint: null, contextWindow: null });
	});

	it("rejects a whitespace-only providerId (stricter than the schema's min(1))", () => {
		expect(() =>
			parseNKleinModelContextWindowOverrideRequest({ providerId: "   ", modelId: "m", contextWindow: null }),
		).toThrow(/Provider ID cannot be empty/);
	});
});

describe("parseWorktreeDeleteRequest (§5.V coverage)", () => {
	it("trims taskId and passes preserveChanges through", () => {
		expect(parseWorktreeDeleteRequest({ taskId: "  t9  ", preserveChanges: true })).toEqual({
			taskId: "t9",
			preserveChanges: true,
		});
	});

	it("leaves preserveChanges undefined when omitted", () => {
		expect(parseWorktreeDeleteRequest({ taskId: "t9" })).toEqual({ taskId: "t9", preserveChanges: undefined });
	});

	it("rejects a blank taskId", () => {
		expect(() => parseWorktreeDeleteRequest({ taskId: "  " })).toThrow(/Invalid worktree delete payload/);
	});
});

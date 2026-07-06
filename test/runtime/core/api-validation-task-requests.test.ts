import { describe, expect, it } from "vitest";
import {
	parseOptionalTaskWorkspaceInfoRequest,
	parseTaskChatAbortRequest,
	parseTaskChatCancelRequest,
	parseTaskChatMessagesRequest,
	parseTaskChatReloadRequest,
	parseTaskPauseRequest,
	parseTaskSessionInputRequest,
	parseTaskSessionStopRequest,
	parseTaskWorkspaceInfoRequest,
} from "../../../src/core/api-validation";

// §5.V — the taskId-centric tRPC parsers all trim taskId and reject blank with a parser-specific message (the trim-check
// is stricter than the `z.string()` schema, which accepts whitespace). Characterized so a dropped trim/guard regresses loudly.

const taskIdOnlyParsers: Array<{ name: string; parse: (v: unknown) => { taskId: string }; blankError: RegExp }> = [
	{
		name: "parseTaskSessionStopRequest",
		parse: parseTaskSessionStopRequest,
		blankError: /Invalid task session stop payload/,
	},
	{ name: "parseTaskPauseRequest", parse: parseTaskPauseRequest, blankError: /Task pause taskId cannot be empty/ },
	{
		name: "parseTaskChatAbortRequest",
		parse: parseTaskChatAbortRequest,
		blankError: /Task chat taskId cannot be empty/,
	},
	{
		name: "parseTaskChatReloadRequest",
		parse: parseTaskChatReloadRequest,
		blankError: /Task chat taskId cannot be empty/,
	},
	{
		name: "parseTaskChatCancelRequest",
		parse: parseTaskChatCancelRequest,
		blankError: /Task chat taskId cannot be empty/,
	},
	{
		name: "parseTaskChatMessagesRequest",
		parse: parseTaskChatMessagesRequest,
		blankError: /Task chat taskId cannot be empty/,
	},
];

describe("taskId-only request parsers (§5.V coverage)", () => {
	for (const { name, parse, blankError } of taskIdOnlyParsers) {
		it(`${name} trims taskId and rejects blank`, () => {
			expect(parse({ taskId: "  t1  " })).toEqual({ taskId: "t1" });
			expect(() => parse({ taskId: "   " })).toThrow(blankError);
			expect(() => parse({})).toThrow(); // schema layer: missing taskId
		});
	}
});

describe("parseTaskSessionInputRequest (§5.V coverage)", () => {
	it("trims taskId while preserving text + appendNewline", () => {
		expect(parseTaskSessionInputRequest({ taskId: "  t2  ", text: "  keep  ", appendNewline: true })).toEqual({
			taskId: "t2",
			text: "  keep  ", // text is NOT trimmed by this parser
			appendNewline: true,
		});
	});

	it("rejects a blank taskId", () => {
		expect(() => parseTaskSessionInputRequest({ taskId: "  ", text: "x" })).toThrow(
			/Task session taskId cannot be empty/,
		);
	});
});

describe("parseTaskWorkspaceInfoRequest (§5.V coverage)", () => {
	it("reads + trims taskId and baseRef from the query", () => {
		const req = parseTaskWorkspaceInfoRequest(new URLSearchParams("taskId=%20t3%20&baseRef=%20main%20"));
		expect(req).toEqual({ taskId: "t3", baseRef: "main" });
	});

	it("requires both taskId and baseRef", () => {
		expect(() => parseTaskWorkspaceInfoRequest(new URLSearchParams("taskId=t3"))).toThrow(/baseRef/);
		expect(() => parseTaskWorkspaceInfoRequest(new URLSearchParams("baseRef=main"))).toThrow(/taskId/);
	});
});

describe("parseOptionalTaskWorkspaceInfoRequest (§5.V coverage)", () => {
	it("returns null when there is no taskId (and no baseRef)", () => {
		expect(parseOptionalTaskWorkspaceInfoRequest(new URLSearchParams(""))).toBeNull();
	});

	it("rejects a baseRef given without a taskId", () => {
		expect(() => parseOptionalTaskWorkspaceInfoRequest(new URLSearchParams("baseRef=main"))).toThrow(
			/baseRef query parameter requires taskId/,
		);
	});

	it("delegates to the required parser when a taskId is present", () => {
		expect(parseOptionalTaskWorkspaceInfoRequest(new URLSearchParams("taskId=t3&baseRef=main"))).toEqual({
			taskId: "t3",
			baseRef: "main",
		});
	});
});

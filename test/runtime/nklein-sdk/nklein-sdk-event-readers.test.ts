import { describe, expect, it } from "vitest";
import {
	readAgentResultText,
	readSdkAgentEvent,
	readSdkSessionEvent,
} from "../../../src/nklein-sdk/nklein-sdk-event-readers";

describe("readSdkAgentEvent", () => {
	it("returns the inner payload.event for an agent_event", () => {
		expect(readSdkAgentEvent({ type: "agent_event", payload: { event: { type: "tool_call" } } })).toEqual({
			type: "tool_call",
		});
	});
	it("returns null for non-agent_event / malformed shapes", () => {
		expect(readSdkAgentEvent({ type: "chunk" })).toBeNull();
		expect(readSdkAgentEvent(null)).toBeNull();
		expect(readSdkAgentEvent([{ type: "agent_event" }])).toBeNull();
	});
});

describe("readSdkSessionEvent", () => {
	it("passes known session-event types through", () => {
		for (const type of ["agent_event", "chunk", "ended", "hook", "status", "team_progress"]) {
			expect(readSdkSessionEvent({ type })).toEqual({ type });
		}
	});
	it("returns null for unknown types and non-objects", () => {
		expect(readSdkSessionEvent({ type: "mystery" })).toBeNull();
		expect(readSdkSessionEvent("nope")).toBeNull();
		expect(readSdkSessionEvent({})).toBeNull();
	});
});

describe("readAgentResultText", () => {
	it("returns the trimmed text", () => {
		expect(readAgentResultText({ text: "  done  " })).toBe("done");
	});
	it("returns null for empty / missing / non-string text", () => {
		expect(readAgentResultText({ text: "   " })).toBeNull();
		expect(readAgentResultText({ text: 42 })).toBeNull();
		expect(readAgentResultText({})).toBeNull();
		expect(readAgentResultText(null)).toBeNull();
	});
});

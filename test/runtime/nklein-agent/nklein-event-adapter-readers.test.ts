import { describe, expect, it } from "vitest";
import {
	readAgentEvent,
	readChunkEvent,
	readEndedEvent,
	readHookEvent,
	readStatusEvent,
} from "../../../src/nklein-agent/nklein-event-adapter-readers";

describe("readAgentEvent", () => {
	it("returns the inner payload.event when the shape matches", () => {
		const inner = { type: "error", message: "boom" };
		expect(readAgentEvent({ type: "agent_event", payload: { event: inner } })).toEqual(inner);
	});

	it("returns null for the wrong outer type, missing payload, or a non-string event type", () => {
		expect(readAgentEvent({ type: "chunk", payload: { event: { type: "x" } } })).toBeNull();
		expect(readAgentEvent({ type: "agent_event" })).toBeNull();
		expect(readAgentEvent({ type: "agent_event", payload: { event: { type: 1 } } })).toBeNull();
		expect(readAgentEvent("nope")).toBeNull();
	});
});

describe("readChunkEvent", () => {
	it("accepts a chunk with a sessionId, string chunk, and a known stream", () => {
		const event = { type: "chunk", payload: { sessionId: "s1", chunk: "hi", stream: "stdout" } };
		expect(readChunkEvent(event)).toEqual({ type: "chunk", payload: event.payload });
	});

	it("rejects a chunk missing fields or with an unknown stream", () => {
		expect(readChunkEvent({ type: "chunk", payload: { sessionId: "s1", chunk: "hi", stream: "weird" } })).toBeNull();
		expect(readChunkEvent({ type: "chunk", payload: { sessionId: "s1", stream: "stdout" } })).toBeNull();
		expect(readChunkEvent({ type: "chunk", payload: { chunk: "hi", stream: "agent" } })).toBeNull();
	});
});

describe("readHookEvent", () => {
	it("accepts a hook with a sessionId and rejects one without", () => {
		expect(readHookEvent({ type: "hook", payload: { sessionId: "s1", hookEventName: "x" } })).toEqual({
			type: "hook",
			payload: { sessionId: "s1", hookEventName: "x" },
		});
		expect(readHookEvent({ type: "hook", payload: {} })).toBeNull();
		expect(readHookEvent({ type: "ended", payload: { sessionId: "s1" } })).toBeNull();
	});
});

describe("readEndedEvent", () => {
	it("requires both sessionId and reason", () => {
		expect(readEndedEvent({ type: "ended", payload: { sessionId: "s1", reason: "done" } })).toEqual({
			type: "ended",
			payload: { sessionId: "s1", reason: "done" },
		});
		expect(readEndedEvent({ type: "ended", payload: { sessionId: "s1" } })).toBeNull();
	});
});

describe("readStatusEvent", () => {
	it("requires both sessionId and status", () => {
		expect(readStatusEvent({ type: "status", payload: { sessionId: "s1", status: "running" } })).toEqual({
			type: "status",
			payload: { sessionId: "s1", status: "running" },
		});
		expect(readStatusEvent({ type: "status", payload: { status: "running" } })).toBeNull();
	});
});

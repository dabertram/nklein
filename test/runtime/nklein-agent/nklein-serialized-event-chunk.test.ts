import { describe, expect, it } from "vitest";

import { isLikelySerializedAgentEventChunk } from "../../../src/nklein-agent/nklein-serialized-event-chunk";

describe("isLikelySerializedAgentEventChunk", () => {
	it("is true for a JSON object/array carrying a type field", () => {
		expect(isLikelySerializedAgentEventChunk('{"type":"agent_event","payload":{}}')).toBe(true);
		expect(isLikelySerializedAgentEventChunk('  {"type":"chunk"}  ')).toBe(true);
	});

	it("is false for genuine program output", () => {
		expect(isLikelySerializedAgentEventChunk("Build succeeded in 2.3s")).toBe(false);
		expect(isLikelySerializedAgentEventChunk("")).toBe(false);
		expect(isLikelySerializedAgentEventChunk("   ")).toBe(false);
	});

	it("is false for a brace-prefixed string that is not valid JSON (no parse cost wasted on plain text)", () => {
		expect(isLikelySerializedAgentEventChunk("{not json")).toBe(false);
		expect(isLikelySerializedAgentEventChunk("[unterminated")).toBe(false);
	});

	it("is false for JSON that lacks a type field", () => {
		expect(isLikelySerializedAgentEventChunk('{"payload":{}}')).toBe(false);
		expect(isLikelySerializedAgentEventChunk("[1,2,3]")).toBe(false);
		expect(isLikelySerializedAgentEventChunk('"just a string"')).toBe(false);
	});
});

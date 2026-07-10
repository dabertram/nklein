import { describe, expect, it } from "vitest";
import { classifyObservedFailure, distillCampaign, distillInteraction, type CapturedInteraction } from "../src/reflection/distill.js";

const workerReq = { messages: [{ role: "system", content: "kanban efficiency rules" }, { role: "user", content: "Work card: Alpha\nmore" }] };

describe("reflection distiller", () => {
	it("classifies observed failures conservatively by mechanically-detectable signals", () => {
		expect(classifyObservedFailure({ request: workerReq, response: { status: 429, content: null } })).toBe("t-429");
		expect(classifyObservedFailure({ request: workerReq, response: { content: "", reasoning: "hmm" } })).toBe("c-reasoning-only");
		expect(classifyObservedFailure({ request: workerReq, response: { content: "" } })).toBe("c-empty-completion");
		expect(classifyObservedFailure({ request: workerReq, response: { content: "ok", finishReason: "length" } })).toBe("c-trunc-length");
		expect(classifyObservedFailure({ request: workerReq, response: { toolCalls: [{ name: "x", arguments: "{bad" }] } })).toBe("c-bad-json-args");
		expect(classifyObservedFailure({ request: workerReq, response: { content: "clean answer" } })).toBe("perfect-observed");
	});

	it("distills an interaction into a class-tagged track with provenance + stable user key", () => {
		const track = distillInteraction({ request: workerReq, response: { content: "done", reasoning: "thought" } }, 3);
		expect(track.requestClass).toBe("worker");
		expect(track.id).toBe("perfect-observed:worker:3");
		expect(track.userMessageIncludes).toBe("Work card: Alpha");
		expect(track.turns[0]?.behavior).toEqual({ kind: "text", content: "done", reasoning: "thought" });
		expect(track.provenance).toContain("distilled from real capture");
	});

	it("round-trips tool calls, parsing string args back to objects", () => {
		const track = distillInteraction({ request: workerReq, response: { toolCalls: [{ name: "write_files", arguments: '{"path":"a.ts"}' }] } }, 0);
		expect(track.turns[0]?.behavior).toEqual({ kind: "tool_calls", calls: [{ name: "write_files", arguments: { path: "a.ts" } }] });
	});

	it("distills a whole campaign", () => {
		const campaign: CapturedInteraction[] = [
			{ request: workerReq, response: { content: "a" } },
			{ request: { messages: [{ role: "user", content: "hi" }] }, response: { content: "b" } },
		];
		const tracks = distillCampaign(campaign);
		expect(tracks).toHaveLength(2);
		expect(tracks[1]?.requestClass).toBe("chat");
	});
});

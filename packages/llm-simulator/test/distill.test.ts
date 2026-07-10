import { describe, expect, it } from "vitest";
import {
	classifyObservedFailure,
	distillCampaign,
	distillInteraction,
	entriesFromCaptureFile,
	type RecordedFixtureEntry,
} from "../src/reflection/distill.js";

// The recorded shape keeps only the LAST user text + per-session turn index (aimock 1.35.1 recorder).
const workerEntry = (response: RecordedFixtureEntry["response"]): RecordedFixtureEntry => ({
	match: { userMessage: "Work card: Alpha. Leaf scope: complete only this card's explicit objective.", model: "qwen2.5-coder-14b", turnIndex: 0 },
	response,
});

describe("reflection distiller (aimock recorded-fixture shape)", () => {
	it("classifies observed failures conservatively by mechanically-detectable signals", () => {
		expect(classifyObservedFailure(workerEntry({ status: 429, content: null }))).toBe("t-429");
		expect(classifyObservedFailure(workerEntry({ content: "", reasoning: "hmm" }))).toBe("c-reasoning-only");
		expect(classifyObservedFailure(workerEntry({ content: "" }))).toBe("c-empty-completion");
		expect(classifyObservedFailure(workerEntry({ content: "ok", finishReason: "length" }))).toBe("c-trunc-length");
		expect(classifyObservedFailure(workerEntry({ toolCalls: [{ name: "x", arguments: "{bad" }] }))).toBe("c-bad-json-args");
		expect(classifyObservedFailure(workerEntry({ content: "clean answer" }))).toBe("perfect-observed");
	});

	it("distills an entry into a class-tagged track with provenance + stable user key", () => {
		const track = distillInteraction(workerEntry({ content: "done", reasoning: "thought" }), 3);
		expect(track.requestClass).toBe("worker");
		expect(track.id).toBe("perfect-observed:worker:3");
		expect(track.userMessageIncludes).toBe("Work card: Alpha. Leaf scope: complete only this card's expl");
		expect(track.turns[0]?.behavior).toEqual({ kind: "text", content: "done", reasoning: "thought" });
		expect(track.provenance).toContain("distilled from real capture");
		expect(track.provenance).toContain("qwen2.5-coder-14b");
	});

	it("pins mid-session captures to their recorded turn via atAssistantCount", () => {
		const entry: RecordedFixtureEntry = {
			match: { userMessage: "You are the second-opinion reviewer for the card \"Alpha\"", turnIndex: 2 },
			response: { content: "verdict text" },
		};
		const track = distillInteraction(entry, 0);
		expect(track.requestClass).toBe("review");
		expect(track.atAssistantCount).toBe(2);
		// turn 0 of a session (turnIndex 0) stays unpinned:
		expect(distillInteraction(workerEntry({ content: "x" }), 0).atAssistantCount).toBeUndefined();
	});

	it("round-trips tool calls, parsing string args back to objects", () => {
		const track = distillInteraction(workerEntry({ toolCalls: [{ name: "write_files", arguments: '{"path":"a.ts"}' }] }), 0);
		expect(track.turns[0]?.behavior).toEqual({ kind: "tool_calls", calls: [{ name: "write_files", arguments: { path: "a.ts" } }] });
	});

	it("distills a whole campaign", () => {
		const campaign: RecordedFixtureEntry[] = [
			workerEntry({ content: "a" }),
			{ match: { userMessage: "hi" }, response: { content: "b" } },
		];
		const tracks = distillCampaign(campaign);
		expect(tracks).toHaveLength(2);
		expect(tracks[1]?.requestClass).toBe("chat");
	});

	it("flattens both capture-file layouts (single fixture and {fixtures:[…]})", () => {
		const single = { match: { userMessage: "hi" }, response: { content: "x" } };
		expect(entriesFromCaptureFile(single)).toHaveLength(1);
		expect(entriesFromCaptureFile({ fixtures: [single, single] })).toHaveLength(2);
		expect(entriesFromCaptureFile({ nonsense: true })).toHaveLength(0);
	});
});

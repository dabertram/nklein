import { describe, expect, it } from "vitest";
import {
	classifyObservedFailure,
	distillCampaign,
	distillInteraction,
	entriesFromCaptureFile,
	entriesFromPersistedTranscript,
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

	it("converts durable SDK transcripts into ordered aimock fixtures without treating tool results as model turns", () => {
		const transcript = {
			sessionId: "benchmark-worker-1",
			system_prompt: "You are NKlein. Efficiency rules apply.",
			messages: [
				{
					role: "user",
					content: [
						{
							type: "text",
							text: "[!Klein context focus brief]\nold chunks\n[/!Klein context focus brief]\n\n# Instructions\n\nRepair the binary search tree implementation.\n\nAcceptance check: npm test",
						},
					],
				},
				{
					role: "assistant",
					modelInfo: { id: "qwen3.6-35b" },
					content: [
						{ type: "thinking", thinking: "inspect first" },
						{ type: "text", text: "I will inspect." },
						{ type: "tool_use", id: "call-1", name: "read_files", input: { paths: ["tree.cpp"] } },
					],
				},
				{
					role: "user",
					content: [{ type: "tool_result", tool_use_id: "call-1", content: "source" }],
				},
				{
					role: "assistant",
					modelInfo: { id: "qwen3.6-35b" },
					content: [{ type: "text", text: "Done and verified." }],
				},
			],
		};

		const entries = entriesFromPersistedTranscript(transcript);
		expect(entries).toHaveLength(2);
		expect(entries[0]).toMatchObject({
			match: {
				model: "qwen3.6-35b",
				turnIndex: 0,
				context: "persisted-session:benchmark-worker-1;class:worker",
			},
			response: {
				content: "I will inspect.",
				reasoning: "inspect first",
				toolCalls: [{ name: "read_files", arguments: { paths: ["tree.cpp"] } }],
			},
		});
		expect(entries[1]?.match?.turnIndex).toBe(1);
		expect(entries[1]?.response).toEqual({ content: "Done and verified." });
		expect(entriesFromCaptureFile(transcript)).toEqual(entries);

		const tracks = distillCampaign(entries);
		expect(tracks[0]?.requestClass).toBe("worker");
		expect(tracks[0]?.userMessageIncludes).toBe("Repair the binary search tree implementation.");
		expect(tracks[1]?.atAssistantCount).toBe(1);
		expect(tracks[0]?.provenance).toContain("persisted-session:benchmark-worker-1");
	});

	it("uses the first reviewer seed rather than quoted worker acceptance text to classify persisted review sessions", () => {
		const entries = entriesFromPersistedTranscript({
			sessionId: "review-1",
			messages: [
				{
					role: "user",
					content: [
						{
							type: "text",
							text: '<user_input mode="act">You are the second-opinion reviewer for card "Tree".\nQuoted worker acceptance check: npm test</user_input>',
						},
					],
				},
				{ role: "assistant", content: [{ type: "tool_use", name: "read_files", input: { paths: ["tree.cpp"] } }] },
			],
		});
		expect(entries[0]?.match?.context).toBe("persisted-session:review-1;class:review");
		expect(distillCampaign(entries)[0]?.requestClass).toBe("review");
	});

	it("keys skill-backed worker captures on the card objective after the shared guidance preamble", () => {
		const tracks = distillCampaign(
			entriesFromPersistedTranscript({
				sessionId: "worker-with-skill",
				messages: [
					{
						role: "user",
						content: [
							{
								type: "text",
								text: "Use this skill when a task touches shared types.\n\nChecklist:\n- Keep edits scoped.\n\nGuidance topic: ts\n\nImplement the score clamp in src/habit-score.ts.\n\nAcceptance check: npm test",
							},
						],
					},
					{ role: "assistant", content: [{ type: "text", text: "done" }] },
				],
			}),
		);
		expect(tracks[0]?.userMessageIncludes).toBe("Implement the score clamp in src/habit-score.ts.");
	});
});

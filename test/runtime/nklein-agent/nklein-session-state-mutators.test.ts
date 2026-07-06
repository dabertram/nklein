import { describe, expect, it } from "vitest";
import {
	appendAssistantChunk,
	appendReasoningChunk,
	clearActiveTurnState,
	finishToolCallMessage,
	type NKleinTaskSessionEntry,
	setOrCreateAssistantMessage,
	setOrCreateReasoningMessage,
	startToolCallMessage,
} from "../../../src/nklein-agent/nklein-session-state";

const freshEntry = (): NKleinTaskSessionEntry =>
	({
		messages: [],
		activeAssistantMessageId: null,
		activeReasoningMessageId: null,
		toolMessageIdByToolCallId: new Map(),
		toolInputByToolCallId: new Map(),
	}) as unknown as NKleinTaskSessionEntry;

describe("appendAssistantChunk (§5.V coverage)", () => {
	it("creates the active assistant message, then appends subsequent chunks to it", () => {
		const entry = freshEntry();
		const first = appendAssistantChunk(entry, "t1", "Hel");
		expect(entry.activeAssistantMessageId).toBe(first.id);
		const second = appendAssistantChunk(entry, "t1", "lo");
		expect(second.id).toBe(first.id); // same message
		expect(entry.messages.length).toBe(1);
		expect(second.content).toBe("Hello"); // appended
	});
});

describe("setOrCreateAssistantMessage (§5.V coverage)", () => {
	it("returns null when there is no active assistant message", () => {
		expect(setOrCreateAssistantMessage(freshEntry(), "t1", "x")).toBeNull();
	});

	it("REPLACES the active assistant message content (not append)", () => {
		const entry = freshEntry();
		appendAssistantChunk(entry, "t1", "partial");
		const updated = setOrCreateAssistantMessage(entry, "t1", "final");
		expect(updated?.content).toBe("final");
		expect(entry.messages.length).toBe(1);
	});
});

describe("reasoning chunk mutators (§5.V coverage)", () => {
	it("appendReasoningChunk builds/extends the active reasoning message with reasoning meta", () => {
		const entry = freshEntry();
		const msg = appendReasoningChunk(entry, "t1", "think");
		expect(msg.role).toBe("reasoning");
		expect(entry.activeReasoningMessageId).toBe(msg.id);
		expect(appendReasoningChunk(entry, "t1", "ing").content).toBe("thinking");
	});

	it("setOrCreateReasoningMessage returns null without an active reasoning message, else replaces with reasoning_end meta", () => {
		expect(setOrCreateReasoningMessage(freshEntry(), "t1", "x")).toBeNull();
		const entry = freshEntry();
		appendReasoningChunk(entry, "t1", "partial");
		const updated = setOrCreateReasoningMessage(entry, "t1", "done");
		expect(updated?.content).toBe("done");
		expect((updated?.meta as { hookEventName: string }).hookEventName).toBe("reasoning_end");
	});
});

describe("tool-call lifecycle (§5.V coverage)", () => {
	it("start records the tool message + input by toolCallId; finish updates it in place and clears the maps", () => {
		const entry = freshEntry();
		const started = startToolCallMessage(entry, "t1", { toolName: "bash", toolCallId: "tc1", input: { cmd: "ls" } });
		expect(started.role).toBe("tool");
		expect(entry.messages.length).toBe(1);
		expect(entry.toolMessageIdByToolCallId.get("tc1")).toBe(started.id);
		expect(entry.toolInputByToolCallId.get("tc1")).toEqual({ cmd: "ls" });

		const finished = finishToolCallMessage(entry, "t1", {
			toolName: "bash",
			toolCallId: "tc1",
			output: "file.txt",
			error: null,
			durationMs: 12,
		});
		expect(finished.id).toBe(started.id); // updated in place, not a new message
		expect(entry.messages.length).toBe(1);
		expect(entry.toolMessageIdByToolCallId.has("tc1")).toBe(false); // maps cleared
		expect(entry.toolInputByToolCallId.has("tc1")).toBe(false);
	});

	it("finish without a prior start creates a fresh tool message", () => {
		const entry = freshEntry();
		const msg = finishToolCallMessage(entry, "t1", {
			toolName: "bash",
			toolCallId: "orphan",
			output: "x",
			error: null,
			durationMs: null,
		});
		expect(msg.role).toBe("tool");
		expect(entry.messages).toContain(msg);
	});
});

describe("clearActiveTurnState (§5.V coverage)", () => {
	it("nulls the active ids and empties the tool-call maps", () => {
		const entry = freshEntry();
		appendAssistantChunk(entry, "t1", "a");
		appendReasoningChunk(entry, "t1", "r");
		startToolCallMessage(entry, "t1", { toolName: "bash", toolCallId: "tc1", input: {} });
		clearActiveTurnState(entry);
		expect(entry.activeAssistantMessageId).toBeNull();
		expect(entry.activeReasoningMessageId).toBeNull();
		expect(entry.toolMessageIdByToolCallId.size).toBe(0);
		expect(entry.toolInputByToolCallId.size).toBe(0);
	});
});

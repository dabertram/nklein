import { describe, expect, it } from "vitest";
import type { RuntimeTaskSessionSummary } from "../../../src/core/api-contract";
import {
	cloneMessage,
	cloneSummary,
	createAssistantMessage,
	createMessage,
	createMessageWithMeta,
	createReasoningMessage,
	type NKleinTaskMessage,
	type NKleinTaskSessionEntry,
} from "../../../src/nklein-agent/nklein-session-state";

describe("cloneSummary (§5.V coverage)", () => {
	it("deep-clones the summary and its nested activity/checkpoint objects", () => {
		const summary = {
			taskId: "t1",
			state: "running",
			latestHookActivity: { hookEventName: "x" },
			latestTurnCheckpoint: null,
			previousTurnCheckpoint: null,
		} as unknown as RuntimeTaskSessionSummary;
		const clone = cloneSummary(summary);
		expect(clone).toEqual(summary);
		expect(clone).not.toBe(summary);
		expect(clone.latestHookActivity).not.toBe(summary.latestHookActivity);
		// Mutating the clone's nested object must not touch the original.
		(clone.latestHookActivity as { hookEventName: string }).hookEventName = "mutated";
		expect((summary.latestHookActivity as { hookEventName: string }).hookEventName).toBe("x");
	});

	it("keeps null nested fields null", () => {
		const summary = {
			taskId: "t1",
			latestHookActivity: null,
			latestTurnCheckpoint: null,
			previousTurnCheckpoint: null,
		} as unknown as RuntimeTaskSessionSummary;
		expect(cloneSummary(summary).latestHookActivity).toBeNull();
	});
});

describe("cloneMessage (§5.V coverage)", () => {
	it("deep-clones images and meta", () => {
		const message = {
			id: "m1",
			role: "user",
			content: "hi",
			images: [{ url: "a" }],
			meta: { hookEventName: "h" },
		} as unknown as NKleinTaskMessage;
		const clone = cloneMessage(message);
		expect(clone).toEqual(message);
		expect(clone.images?.[0]).not.toBe(message.images?.[0]);
		expect(clone.meta).not.toBe(message.meta);
	});
});

describe("createMessage / createMessageWithMeta (§5.V coverage)", () => {
	it("builds a message with a task-prefixed id, and clones images (undefined when empty)", () => {
		const msg = createMessage("t1", "user", "hello", [{ url: "a" } as never]);
		expect(msg.role).toBe("user");
		expect(msg.content).toBe("hello");
		expect(msg.id.startsWith("t1-")).toBe(true);
		expect(typeof msg.createdAt).toBe("number");
		expect(msg.images?.[0]).toEqual({ url: "a" });
		expect(createMessage("t1", "user", "x").images).toBeUndefined();
		expect(createMessage("t1", "user", "x", []).images).toBeUndefined();
	});

	it("attaches meta", () => {
		const msg = createMessageWithMeta("t1", "system", "c", { hookEventName: "h" } as never);
		expect(msg.meta).toEqual({ hookEventName: "h" });
	});
});

describe("createAssistantMessage / createReasoningMessage (§5.V coverage)", () => {
	const freshEntry = (): NKleinTaskSessionEntry => ({ messages: [] }) as unknown as NKleinTaskSessionEntry;

	it("appends an assistant message and records it as the active assistant message", () => {
		const entry = freshEntry();
		const msg = createAssistantMessage(entry, "t1", "answer");
		expect(msg.role).toBe("assistant");
		expect(entry.messages).toContain(msg);
		expect(entry.activeAssistantMessageId).toBe(msg.id);
	});

	it("appends a reasoning message with reasoning meta and records the active reasoning id", () => {
		const entry = freshEntry();
		const msg = createReasoningMessage(entry, "t1", "thinking", "reasoning_delta");
		expect(msg.role).toBe("reasoning");
		expect(msg.meta).toEqual({ hookEventName: "reasoning_delta", streamType: "reasoning" });
		expect(entry.messages).toContain(msg);
		expect(entry.activeReasoningMessageId).toBe(msg.id);
	});
});

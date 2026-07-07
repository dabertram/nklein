import { describe, expect, it } from "vitest";
import {
	createInitialRuntimeStateStreamStore,
	decideSnapshotAdoption,
	runtimeStateStreamReducer,
} from "./use-runtime-state-stream";

// The "batch" action coalesces many high-frequency WS frames into ONE reducer transition (one re-render). Its
// correctness contract: folding a batch must be IDENTICAL to applying the same actions individually, and it must drop
// no frame. These tests lock that — the perf throttle must never change observable state.

function chatMessageAction(taskId: string, id: string, content: string) {
	return {
		type: "task_chat_message" as const,
		payload: {
			type: "task_chat_message" as const,
			workspaceId: "ws-1",
			taskId,
			message: { id, role: "assistant" as const, content, createdAt: 1 },
		},
	};
}

describe("runtimeStateStreamReducer batch coalescing", () => {
	it("folds a batch identically to applying each action individually (order-preserving)", () => {
		const initial = createInitialRuntimeStateStreamStore("ws-1");
		const actions = [
			{ type: "stream_error", message: "blip" } as const,
			{ type: "stream_connected" } as const,
			chatMessageAction("t-1", "m1", "first"),
			chatMessageAction("t-1", "m2", "second"),
			{ type: "task_sessions_updated" as const, summaries: [] },
		];
		const batched = runtimeStateStreamReducer(initial, { type: "batch", actions });
		const sequential = actions.reduce(runtimeStateStreamReducer, initial);
		expect(batched).toEqual(sequential);
		// stream_connected cleared the earlier error (order mattered, and the batch respected it).
		expect(batched.streamError).toBeNull();
	});

	it("keeps EVERY task_chat_message in a batch (no frame dropped)", () => {
		const initial = createInitialRuntimeStateStreamStore("ws-1");
		const actions = Array.from({ length: 50 }, (_, i) => chatMessageAction("t-1", `m${i}`, `delta ${i}`));
		const result = runtimeStateStreamReducer(initial, { type: "batch", actions });
		expect(result.taskChatMessagesByTaskId["t-1"]).toHaveLength(50);
		expect(result.latestTaskChatMessage?.message.id).toBe("m49");
	});

	it("an empty batch is a no-op (returns an equivalent state)", () => {
		const initial = createInitialRuntimeStateStreamStore("ws-1");
		expect(runtimeStateStreamReducer(initial, { type: "batch", actions: [] })).toEqual(initial);
	});

	it("a single existing (non-batched) action still works unchanged", () => {
		const initial = createInitialRuntimeStateStreamStore("ws-1");
		const result = runtimeStateStreamReducer(initial, chatMessageAction("t-9", "only", "hi"));
		expect(result.taskChatMessagesByTaskId["t-9"]).toHaveLength(1);
	});
});

describe("decideSnapshotAdoption (the project-switch stall root-cause rule)", () => {
	it("adopts when nothing specific was requested, or the snapshot serves the requested workspace", () => {
		expect(decideSnapshotAdoption(null, "p1")).toBe("adopt");
		expect(decideSnapshotAdoption("p1", "p1")).toBe("adopt");
		expect(decideSnapshotAdoption("p1", null)).toBe("adopt"); // no id to disagree with — adopt (older payloads)
	});

	it("refetches a STALE snapshot (a different workspace than requested) instead of adopting its id", () => {
		// Adopting the mismatched id made the per-workspace filters drop every update for the NEW workspace —
		// the board sat empty until the next snapshot. The rule: skip + refetch (backoff-bounded).
		expect(decideSnapshotAdoption("new-project", "old-project")).toBe("refetch_stale");
	});
});

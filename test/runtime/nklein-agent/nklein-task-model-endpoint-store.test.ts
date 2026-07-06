import { describe, expect, it } from "vitest";

import {
	TaskModelEndpointStore,
	UNCONFIGURED_MODEL_ID,
} from "../../../src/nklein-agent/nklein-task-model-endpoint-store";

describe("TaskModelEndpointStore", () => {
	it("stores and reads back the model id and endpoint", () => {
		const store = new TaskModelEndpointStore();
		store.set("t1", "qwen3-8b", "http://localhost:1234/v1");
		expect(store.getModelId("t1")).toBe("qwen3-8b");
		expect(store.getEndpoint("t1")).toBe("http://localhost:1234/v1");
	});

	it("getModelId defaults an unknown task to UNCONFIGURED_MODEL_ID", () => {
		const store = new TaskModelEndpointStore();
		expect(store.getModelId("missing")).toBe(UNCONFIGURED_MODEL_ID);
	});

	it("peekModelId returns the raw value (undefined when absent) for chained-fallback callers", () => {
		const store = new TaskModelEndpointStore();
		expect(store.peekModelId("missing")).toBeUndefined();
		store.set("t1", "qwen3-8b", null);
		expect(store.peekModelId("t1")).toBe("qwen3-8b");
	});

	it("getModelId and peekModelId differ for an absent task — the bug the chained reads avoid", () => {
		const store = new TaskModelEndpointStore();
		// A chained `summary.modelId ?? peekModelId(t) ?? null` must see undefined (→ null), NOT
		// the "unconfigured" sentinel that getModelId would substitute.
		expect(store.getModelId("missing")).toBe(UNCONFIGURED_MODEL_ID);
		expect(store.peekModelId("missing") ?? null).toBeNull();
	});

	it("getEndpoint defaults an unknown task to null and preserves a stored null", () => {
		const store = new TaskModelEndpointStore();
		expect(store.getEndpoint("missing")).toBeNull();
		store.set("t1", "qwen3-8b", null);
		expect(store.getEndpoint("t1")).toBeNull();
	});

	it("getEndpoint is idempotent in a chained `summary.endpoint ?? getEndpoint(t)` position", () => {
		const store = new TaskModelEndpointStore();
		store.set("t1", "m", "http://e");
		// Mirrors the call site `summary.endpoint ?? this.modelEndpoint.getEndpoint(taskId)`, where
		// summary.endpoint is string | null. getEndpoint's baked `?? null` makes the chain collapse to
		// the same value the prior inline `… ?? get ?? null` produced (a present summary value wins,
		// else the stored endpoint, else null).
		const chain = (summaryEndpoint: string | null, taskId: string): string | null =>
			summaryEndpoint ?? store.getEndpoint(taskId);
		expect(chain("http://summary", "t1")).toBe("http://summary");
		expect(chain(null, "t1")).toBe("http://e");
		expect(chain(null, "missing")).toBeNull();
	});

	it("forget drops both the model id and endpoint together", () => {
		const store = new TaskModelEndpointStore();
		store.set("t1", "qwen3-8b", "http://e");
		store.forget("t1");
		expect(store.getModelId("t1")).toBe(UNCONFIGURED_MODEL_ID);
		expect(store.getEndpoint("t1")).toBeNull();
		expect(store.peekModelId("t1")).toBeUndefined();
	});

	it("keeps per-task entries independent and clear() drops everything", () => {
		const store = new TaskModelEndpointStore();
		store.set("t1", "m1", "http://e1");
		store.set("t2", "m2", "http://e2");
		store.forget("t1");
		expect(store.getModelId("t1")).toBe(UNCONFIGURED_MODEL_ID);
		expect(store.getModelId("t2")).toBe("m2");
		store.clear();
		expect(store.peekModelId("t2")).toBeUndefined();
	});

	describe("stable model key (§5.BG)", () => {
		it("stores + reads the stable key separately from the runtime model id", () => {
			const store = new TaskModelEndpointStore();
			// runtime id = the renamable LM Studio alias; stable key = the publisher key telemetry should use.
			store.set("t1", "qwen3-8b-m5max", "http://e", "qwen3-8b");
			expect(store.getModelId("t1")).toBe("qwen3-8b-m5max"); // still the runtime id (used to call the endpoint)
			expect(store.getStableModelKey("t1")).toBe("qwen3-8b");
		});

		it("returns null when no stable key was recorded (absent, omitted, or blank) — caller falls back to the runtime id", () => {
			const store = new TaskModelEndpointStore();
			expect(store.getStableModelKey("missing")).toBeNull();
			store.set("cloud", "openai/gpt-5", null); // omitted (cloud model)
			expect(store.getStableModelKey("cloud")).toBeNull();
			store.set("blank", "m", null, "   "); // blank ⇒ treated as absent
			expect(store.getStableModelKey("blank")).toBeNull();
		});

		it("a re-set without a stable key clears a previously-recorded one (no stale key survives)", () => {
			const store = new TaskModelEndpointStore();
			store.set("t1", "m", null, "qwen3-8b");
			store.set("t1", "m", null); // e.g. a restart path that couldn't resolve the descriptor
			expect(store.getStableModelKey("t1")).toBeNull();
		});

		it("forget and clear drop the stable key too", () => {
			const store = new TaskModelEndpointStore();
			store.set("t1", "m", null, "qwen3-8b");
			store.forget("t1");
			expect(store.getStableModelKey("t1")).toBeNull();
			store.set("t2", "m", null, "qwen2.5-coder");
			store.clear();
			expect(store.getStableModelKey("t2")).toBeNull();
		});
	});
});

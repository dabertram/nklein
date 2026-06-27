import { describe, expect, it } from "vitest";
import type { ProtectedTestApprovalRequest } from "../../../src/core/agent-write-guard";
import {
	buildProtectedTestApprovalKey,
	createProtectedTestApprovalStore,
} from "../../../src/core/protected-test-approval-store";

function request(over: Partial<ProtectedTestApprovalRequest> = {}): ProtectedTestApprovalRequest {
	return {
		intent: "change protected path",
		diff: "- a\n+ b",
		reason: "fix",
		expectedEffects: "none",
		...over,
	};
}

describe("buildProtectedTestApprovalKey", () => {
	it("is deterministic for the same task + request and differs when the request changes", () => {
		const req = request();
		expect(buildProtectedTestApprovalKey("t1", req)).toBe(buildProtectedTestApprovalKey("t1", req));
		expect(buildProtectedTestApprovalKey("t1", req)).not.toBe(buildProtectedTestApprovalKey("t2", req));
		expect(buildProtectedTestApprovalKey("t1", req)).not.toBe(
			buildProtectedTestApprovalKey("t1", request({ diff: "different" })),
		);
	});

	it("is a taskId:sha256hex shape", () => {
		expect(buildProtectedTestApprovalKey("t1", request())).toMatch(/^t1:[0-9a-f]{64}$/u);
	});
});

describe("createProtectedTestApprovalStore", () => {
	it("consumes a matching grant exactly once (one-time use)", () => {
		const store = createProtectedTestApprovalStore();
		const req = request();
		store.grant({ taskId: "t1", request: req, approvedAt: 1 });
		expect(store.consume({ taskId: "t1", request: req })?.approvedAt).toBe(1);
		expect(store.consume({ taskId: "t1", request: req })).toBeNull(); // already consumed
	});

	it("does not consume when the request content differs", () => {
		const store = createProtectedTestApprovalStore();
		store.grant({ taskId: "t1", request: request(), approvedAt: 1 });
		expect(store.consume({ taskId: "t1", request: request({ diff: "other" }) })).toBeNull();
	});

	it("falls back to content matching when no taskId is supplied", () => {
		const store = createProtectedTestApprovalStore();
		const req = request();
		store.grant({ taskId: "t1", request: req, approvedAt: 7 });
		// No taskId → match by request content; still one-time.
		expect(store.consume({ request: req })?.approvedAt).toBe(7);
		expect(store.consume({ request: req })).toBeNull();
	});

	it("clear() drops all pending grants", () => {
		const store = createProtectedTestApprovalStore();
		const req = request();
		store.grant({ taskId: "t1", request: req, approvedAt: 1 });
		store.clear();
		expect(store.consume({ taskId: "t1", request: req })).toBeNull();
	});
});

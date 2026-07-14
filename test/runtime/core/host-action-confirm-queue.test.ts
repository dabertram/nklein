import { describe, expect, it, vi } from "vitest";
import {
	createHostActionConfirmQueue,
	type HostActionConfirmRequest,
} from "../../../src/core/host-action-confirm-queue";

const req = (over: Partial<HostActionConfirmRequest> = {}): HostActionConfirmRequest => ({
	attemptId: "att-1",
	sessionId: "sess-1",
	action: "host_command",
	target: "npm test",
	...over,
});

describe("createHostActionConfirmQueue (F2.2b/F2.12b)", () => {
	it("enqueue is idempotent per attemptId (re-enqueue returns the existing entry)", () => {
		const q = createHostActionConfirmQueue();
		const first = q.enqueue(req(), 0, 1000);
		const second = q.enqueue(req({ target: "different" }), 500, 9999);
		expect(second).toEqual(first); // same entry, original facts + deadline
		expect(q.listPending(0)).toHaveLength(1);
	});

	it("applies an operator approval bound to (attemptId, sessionId, action, target)", () => {
		const q = createHostActionConfirmQueue();
		q.enqueue(req(), 0, 1000);
		expect(q.resolve({ ...req(), approve: true }, 100)).toBe("applied");
		expect(q.status("att-1", 100)).toBe("approved");
	});

	it("a decision against different facts than what is queued applies to NOTHING (mismatch)", () => {
		const q = createHostActionConfirmQueue();
		q.enqueue(req({ target: "npm test" }), 0, 1000);
		expect(q.resolve({ ...req({ target: "rm -rf /" }), approve: true }, 100)).toBe("mismatch");
		expect(q.status("att-1", 100)).toBe("pending"); // still waiting
	});

	it("expiry is deny: past the deadline it resolves expired and can never be approved", () => {
		const q = createHostActionConfirmQueue();
		q.enqueue(req(), 0, 1000);
		expect(q.status("att-1", 1000)).toBe("expired");
		expect(q.resolve({ ...req(), approve: true }, 1000)).toBe("expired");
	});

	it("decisions are one-shot (already_resolved) and take() consumes the entry", () => {
		const q = createHostActionConfirmQueue();
		q.enqueue(req(), 0, 1000);
		expect(q.resolve({ ...req(), approve: false }, 100)).toBe("applied");
		expect(q.resolve({ ...req(), approve: true }, 100)).toBe("already_resolved");
		expect(q.take("att-1", 100)).toBe("denied");
		expect(q.status("att-1", 100)).toBe("unknown"); // consumed
	});

	it("resolve/status/take on an unknown attempt change nothing", () => {
		const q = createHostActionConfirmQueue();
		expect(q.resolve({ ...req(), approve: true }, 0)).toBe("unknown");
		expect(q.status("nope", 0)).toBe("unknown");
		expect(q.take("nope", 0)).toBe("unknown");
	});

	it("listPending returns unexpired unresolved attempts oldest-first; sweep drops the expired", () => {
		const q = createHostActionConfirmQueue();
		q.enqueue(req({ attemptId: "a" }), 10, 1000);
		q.enqueue(req({ attemptId: "b" }), 5, 1000);
		q.enqueue(req({ attemptId: "c" }), 20, 100); // expires at 120
		expect(q.listPending(50).map((p) => p.attemptId)).toEqual(["b", "a", "c"]); // requestedAt order; all pending at 50
		const swept = q.sweep(200);
		expect(swept.map((p) => p.attemptId)).toEqual(["c"]);
		expect(q.listPending(200).map((p) => p.attemptId)).toEqual(["b", "a"]);
	});

	it("subscribe fires at most once on resolution and on expiry, and unsubscribe stops it", () => {
		const q = createHostActionConfirmQueue();
		q.enqueue(req(), 0, 1000);
		const onSettled = vi.fn();
		q.subscribe("att-1", onSettled);
		q.resolve({ ...req(), approve: true }, 100);
		q.resolve({ ...req(), approve: false }, 100); // already resolved — no second fire
		expect(onSettled).toHaveBeenCalledTimes(1);
		expect(onSettled).toHaveBeenCalledWith("approved");

		// A subscriber added AFTER resolution fires immediately with the settled status.
		const late = vi.fn();
		q.subscribe("att-1", late);
		expect(late).toHaveBeenCalledWith("approved");

		// Unsubscribe before settling stops the callback.
		q.enqueue(req({ attemptId: "att-2" }), 0, 1000);
		const never = vi.fn();
		const unsub = q.subscribe("att-2", never);
		unsub();
		q.resolve({ ...req({ attemptId: "att-2" }), approve: true }, 100);
		expect(never).not.toHaveBeenCalled();
	});
});

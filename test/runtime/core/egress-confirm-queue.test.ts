import { describe, expect, it } from "vitest";
import { createEgressConfirmQueue, DEFAULT_EGRESS_CONFIRM_TIMEOUT_MS } from "../../../src/core/egress-confirm-queue";

/**
 * F2.3 (I5) — the confirm queue's fail-closed properties: decisions bound to attempt+target+role (mismatch
 * applies to nothing), one-shot consumption, expiry-is-deny, and the subscriber hook the proxy waits on.
 */

const REQUEST = { attemptId: "a1", host: "api.example.com", port: 443, role: "worker" };

describe("createEgressConfirmQueue", () => {
	it("approve applies only when attempt+host+port+role ALL match; any mismatch applies to nothing", () => {
		const queue = createEgressConfirmQueue();
		queue.enqueue(REQUEST, 1_000);
		// Wrong host — the operator approved different facts than what is queued.
		expect(queue.resolve({ ...REQUEST, host: "evil.example.com", approve: true }, 2_000)).toBe("mismatch");
		expect(queue.status("a1", 2_000)).toBe("pending"); // still waiting — mismatch resolved nothing
		expect(queue.resolve({ ...REQUEST, port: 80, approve: true }, 2_000)).toBe("mismatch");
		expect(queue.resolve({ ...REQUEST, role: "architect", approve: true }, 2_000)).toBe("mismatch");
		expect(queue.resolve({ ...REQUEST, approve: true }, 2_000)).toBe("applied");
		expect(queue.status("a1", 2_500)).toBe("approved");
	});

	it("decisions are one-shot: take consumes, and a consumed approval can never replay", () => {
		const queue = createEgressConfirmQueue();
		queue.enqueue(REQUEST, 1_000);
		queue.resolve({ ...REQUEST, approve: true }, 2_000);
		expect(queue.take("a1", 2_500)).toBe("approved");
		expect(queue.take("a1", 2_600)).toBe("unknown"); // gone — no replay
		expect(queue.resolve({ ...REQUEST, approve: true }, 2_700)).toBe("unknown");
	});

	it("expiry is deny: a late approval cannot land, sweep returns expired entries", () => {
		const queue = createEgressConfirmQueue();
		queue.enqueue(REQUEST, 1_000, 5_000);
		const late = 1_000 + 5_000;
		expect(queue.status("a1", late)).toBe("expired");
		expect(queue.resolve({ ...REQUEST, approve: true }, late)).toBe("expired");
		const swept = queue.sweep(late);
		expect(swept.map((entry) => entry.attemptId)).toEqual(["a1"]);
		expect(queue.status("a1", late)).toBe("unknown");
	});

	it("subscribers fire once on resolve/expiry (the proxy's bounded wait hook)", () => {
		const queue = createEgressConfirmQueue();
		queue.enqueue(REQUEST, 1_000);
		const events: string[] = [];
		queue.subscribe("a1", (status) => events.push(status));
		queue.resolve({ ...REQUEST, approve: false }, 2_000);
		queue.resolve({ ...REQUEST, approve: true }, 2_100); // already resolved — no double fire
		expect(events).toEqual(["denied"]);

		queue.enqueue({ ...REQUEST, attemptId: "a2" }, 1_000, 1_000);
		queue.subscribe("a2", (status) => events.push(status));
		queue.sweep(3_000);
		expect(events).toEqual(["denied", "expired"]);
	});

	it("enqueue is idempotent per attemptId and listPending shows only live entries oldest-first", () => {
		const queue = createEgressConfirmQueue();
		const first = queue.enqueue(REQUEST, 1_000);
		const again = queue.enqueue({ ...REQUEST, host: "other" }, 9_999);
		expect(again).toEqual(first); // same attemptId — the original facts stand
		queue.enqueue({ ...REQUEST, attemptId: "a2" }, 2_000);
		expect(queue.listPending(3_000).map((entry) => entry.attemptId)).toEqual(["a1", "a2"]);
		expect(first.expiresAt - first.requestedAt).toBe(DEFAULT_EGRESS_CONFIRM_TIMEOUT_MS);
	});
});

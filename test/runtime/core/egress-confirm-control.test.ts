import { describe, expect, it } from "vitest";
import { handleEgressConfirmControlRequest } from "../../../src/core/egress-confirm-control";
import { createEgressConfirmQueue, type EgressConfirmRequest } from "../../../src/core/egress-confirm-queue";

const req: EgressConfirmRequest = { attemptId: "a1", host: "example.com", port: 443, role: "worker" };

describe("handleEgressConfirmControlRequest (F2.3b)", () => {
	it("lists pending confirms on GET, oldest first", () => {
		const queue = createEgressConfirmQueue();
		queue.enqueue(req, 1000);
		const res = handleEgressConfirmControlRequest({ method: "GET", path: "/egress-confirms" }, queue, 1001);
		expect(res.status).toBe(200);
		expect((res.body as { pending: EgressConfirmRequest[] }).pending.map((p) => p.attemptId)).toEqual(["a1"]);
	});

	it("applies a fully-bound resolve decision", () => {
		const queue = createEgressConfirmQueue();
		queue.enqueue(req, 1000);
		const res = handleEgressConfirmControlRequest(
			{ method: "POST", path: "/egress-confirms/resolve", body: { ...req, approve: true } },
			queue,
			1001,
		);
		expect(res.status).toBe(200);
		expect((res.body as { outcome: string }).outcome).toBe("applied");
	});

	it("fails closed (400, never approves) on a malformed resolve body", () => {
		const queue = createEgressConfirmQueue();
		queue.enqueue(req, 1000);
		for (const bad of [
			null,
			{ attemptId: "a1" }, // missing host/port/role/approve
			{ ...req, approve: "yes" }, // approve not boolean
			{ ...req, port: "443", approve: true }, // port not a number
		]) {
			const res = handleEgressConfirmControlRequest(
				{ method: "POST", path: "/egress-confirms/resolve", body: bad },
				queue,
				1001,
			);
			expect(res.status).toBe(400);
		}
		// The attempt is still pending — no spurious approval slipped through.
		expect(queue.listPending(1002).map((p) => p.attemptId)).toEqual(["a1"]);
	});

	it("returns the queue's mismatch outcome when the decision's binding does not match", () => {
		const queue = createEgressConfirmQueue();
		queue.enqueue(req, 1000);
		const res = handleEgressConfirmControlRequest(
			{ method: "POST", path: "/egress-confirms/resolve", body: { ...req, host: "evil.com", approve: true } },
			queue,
			1001,
		);
		expect(res.status).toBe(200);
		expect((res.body as { outcome: string }).outcome).toBe("mismatch");
	});

	it("404s an unknown route", () => {
		const queue = createEgressConfirmQueue();
		expect(handleEgressConfirmControlRequest({ method: "GET", path: "/nope" }, queue, 1000).status).toBe(404);
	});
});

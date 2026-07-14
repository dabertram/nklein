import { describe, expect, it } from "vitest";
import { handleEgressConfirmControlRequest } from "./egress-confirm-control";
import { createEgressConfirmQueue, type EgressConfirmRequest } from "./egress-confirm-queue";

const ATTEMPT: EgressConfirmRequest = { attemptId: "a1", host: "api.github.com", port: 443, role: "worker" };

describe("handleEgressConfirmControlRequest (F2.3b loopback control logic)", () => {
	it("GET /egress-confirms lists the pending attempts oldest-first", () => {
		const queue = createEgressConfirmQueue();
		queue.enqueue(ATTEMPT, 1000, 60_000);
		const response = handleEgressConfirmControlRequest({ method: "GET", path: "/egress-confirms" }, queue, 1000);
		expect(response.status).toBe(200);
		expect(response.body).toEqual({
			pending: [{ ...ATTEMPT, requestedAt: 1000, expiresAt: 61_000 }],
		});
	});

	it("POST /egress-confirms/resolve applies a correctly-bound approval", () => {
		const queue = createEgressConfirmQueue();
		queue.enqueue(ATTEMPT, 1000, 60_000);
		const response = handleEgressConfirmControlRequest(
			{ method: "POST", path: "/egress-confirms/resolve", body: { ...ATTEMPT, approve: true } },
			queue,
			1000,
		);
		expect(response).toEqual({ status: 200, body: { outcome: "applied" } });
		// The queue now reports it approved.
		expect(queue.status("a1", 1000)).toBe("approved");
	});

	it("a mismatched resolve applies to NOTHING (fail-closed) — outcome 'mismatch', attempt still pending", () => {
		const queue = createEgressConfirmQueue();
		queue.enqueue(ATTEMPT, 1000, 60_000);
		const response = handleEgressConfirmControlRequest(
			{
				method: "POST",
				path: "/egress-confirms/resolve",
				body: { ...ATTEMPT, host: "evil.example", approve: true },
			},
			queue,
			1000,
		);
		expect(response.body).toEqual({ outcome: "mismatch" });
		expect(queue.status("a1", 1000)).toBe("pending");
	});

	it("a malformed resolve body is a 400 and NEVER approves", () => {
		const queue = createEgressConfirmQueue();
		queue.enqueue(ATTEMPT, 1000, 60_000);
		for (const body of [null, {}, { attemptId: "a1" }, { ...ATTEMPT, approve: "yes" }, { ...ATTEMPT, port: "443" }]) {
			const response = handleEgressConfirmControlRequest(
				{ method: "POST", path: "/egress-confirms/resolve", body },
				queue,
				1000,
			);
			expect(response.status).toBe(400);
		}
		expect(queue.status("a1", 1000)).toBe("pending");
	});

	it("an unknown route is a 404", () => {
		const queue = createEgressConfirmQueue();
		expect(handleEgressConfirmControlRequest({ method: "DELETE", path: "/whatever" }, queue, 1000).status).toBe(404);
		expect(
			handleEgressConfirmControlRequest({ method: "GET", path: "/egress-confirms/resolve" }, queue, 1000).status,
		).toBe(404);
	});
});

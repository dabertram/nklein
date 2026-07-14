import type { EgressConfirmQueue } from "./egress-confirm-queue";

/**
 * F2.3b — the pure request logic for the egress-confirm LOOPBACK control channel. The egress proxy runs INSIDE the
 * sandbox container and holds the {@link EgressConfirmQueue}; the operator (in the host runtime) reaches it over a
 * 127.0.0.1-bound HTTP surface. This module is that surface's routing/validation, kept pure so it's unit-tested
 * without a socket: the thin HTTP server (a fleet-gated b-leaf) only binds a port, reads the body, and calls this.
 *
 * Routes (all fail-closed — a malformed resolve NEVER approves anything; the queue's own binding rejects a mismatch):
 *   - `GET  /egress-confirms`         → the pending attempts (host/port/role the operator must decide), oldest first
 *   - `POST /egress-confirms/resolve` → apply one operator decision (attemptId+host+port+role bound; approve boolean)
 */

export interface EgressConfirmControlRequest {
	method: string;
	path: string;
	/** The parsed JSON body for POST routes (already JSON.parsed by the caller); ignored for GET. */
	body?: unknown;
}

export interface EgressConfirmControlResponse {
	status: number;
	body: unknown;
}

interface ParsedResolveDecision {
	attemptId: string;
	host: string;
	port: number;
	role: string;
	approve: boolean;
}

/** Validate a resolve body to the exact bound shape; anything off returns null (⇒ a 400, never a spurious approval). */
function parseResolveDecision(body: unknown): ParsedResolveDecision | null {
	if (typeof body !== "object" || body === null) {
		return null;
	}
	const record = body as Record<string, unknown>;
	if (
		typeof record.attemptId !== "string" ||
		typeof record.host !== "string" ||
		typeof record.port !== "number" ||
		!Number.isInteger(record.port) ||
		typeof record.role !== "string" ||
		typeof record.approve !== "boolean"
	) {
		return null;
	}
	return {
		attemptId: record.attemptId,
		host: record.host,
		port: record.port,
		role: record.role,
		approve: record.approve,
	};
}

/** Route + apply one control request against the queue. Pure; the HTTP server supplies `now` (injectable clock). */
export function handleEgressConfirmControlRequest(
	request: EgressConfirmControlRequest,
	queue: EgressConfirmQueue,
	now: number,
): EgressConfirmControlResponse {
	if (request.method === "GET" && request.path === "/egress-confirms") {
		return { status: 200, body: { pending: queue.listPending(now) } };
	}
	if (request.method === "POST" && request.path === "/egress-confirms/resolve") {
		const decision = parseResolveDecision(request.body);
		if (!decision) {
			return { status: 400, body: { error: "invalid resolve request" } };
		}
		return { status: 200, body: { outcome: queue.resolve(decision, now) } };
	}
	return { status: 404, body: { error: "not found" } };
}

import type { EgressConfirmQueue } from "./egress-confirm-queue";
import type { EgressTaskGrantRegistry } from "./egress-task-grants";
import type { EgressTaskIdentityRegistry } from "./egress-task-identity";

/**
 * F2.3b — the pure request logic for the egress-confirm LOOPBACK control channel. The egress proxy runs INSIDE the
 * sandbox container and holds the {@link EgressConfirmQueue}; the operator (in the host runtime) reaches it over a
 * 127.0.0.1-bound HTTP surface. This module is that surface's routing/validation, kept pure so it's unit-tested
 * without a socket: the thin HTTP server (a fleet-gated b-leaf) only binds a port, reads the body, and calls this.
 *
 * Routes (all fail-closed — malformed input never mutates either state machine):
 *   - `GET  /egress-confirms`         → the pending attempts (host/port/role the operator must decide), oldest first
 *   - `POST /egress-confirms/resolve` → apply one operator decision (attemptId+host+port+role bound; approve boolean)
 *   - `POST /task-identities/issue`    → register one host-issued task credential
 *   - `POST /task-identities/revoke`   → revoke one task credential before releasing its sandbox placement
 *   - `POST /task-grants/issue`        → register one time-bounded per-task host grant (the `lookup` fetch leg)
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

function parseTaskIdentityIssue(body: unknown): { taskId: string; token: string } | null {
	if (typeof body !== "object" || body === null) return null;
	const record = body as Record<string, unknown>;
	if (
		typeof record.taskId !== "string" ||
		record.taskId.length === 0 ||
		typeof record.token !== "string" ||
		record.token.length < 32
	) {
		return null;
	}
	return { taskId: record.taskId, token: record.token };
}

function parseTaskGrantIssue(body: unknown): { taskId: string; host: string; ttlMs: number; purpose?: string } | null {
	if (typeof body !== "object" || body === null) return null;
	const record = body as Record<string, unknown>;
	if (
		typeof record.taskId !== "string" ||
		record.taskId.length === 0 ||
		typeof record.host !== "string" ||
		record.host.length === 0 ||
		typeof record.ttlMs !== "number" ||
		!Number.isFinite(record.ttlMs)
	) {
		return null;
	}
	return {
		taskId: record.taskId,
		host: record.host,
		ttlMs: record.ttlMs,
		...(typeof record.purpose === "string" ? { purpose: record.purpose } : {}),
	};
}

function parseTaskIdentityRevoke(body: unknown): { taskId: string } | null {
	if (typeof body !== "object" || body === null) return null;
	const taskId = (body as Record<string, unknown>).taskId;
	return typeof taskId === "string" && taskId.length > 0 ? { taskId } : null;
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
	taskIdentities?: EgressTaskIdentityRegistry,
	taskGrants?: EgressTaskGrantRegistry,
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
	if (request.method === "POST" && request.path === "/task-identities/issue") {
		const identity = parseTaskIdentityIssue(request.body);
		if (!identity || !taskIdentities) return { status: 400, body: { error: "invalid task identity" } };
		taskIdentities.issue(identity.taskId, identity.token);
		return { status: 200, body: { outcome: "applied" } };
	}
	if (request.method === "POST" && request.path === "/task-identities/revoke") {
		const identity = parseTaskIdentityRevoke(request.body);
		if (!identity || !taskIdentities) return { status: 400, body: { error: "invalid task identity" } };
		taskIdentities.revoke(identity.taskId);
		return { status: 200, body: { outcome: "applied" } };
	}
	if (request.method === "POST" && request.path === "/task-grants/issue") {
		const grant = parseTaskGrantIssue(request.body);
		if (!grant || !taskGrants) return { status: 400, body: { error: "invalid task grant" } };
		// A grant for a task without an issued credential is unattributable — the proxy only consults grants for
		// credentialed requests, so refusing here keeps the control surface honest about what it can enforce.
		if (taskIdentities && !taskIdentities.has(grant.taskId)) {
			return { status: 409, body: { error: "task has no issued credential" } };
		}
		const issued = taskGrants.issue(grant, now);
		if (!issued) return { status: 400, body: { error: "invalid task grant host" } };
		return { status: 200, body: { outcome: "applied", host: issued.host, expiresAt: issued.expiresAt } };
	}
	return { status: 404, body: { error: "not found" } };
}

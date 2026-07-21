import type {
	EgressConfirmRequest,
	EgressConfirmResolveOutcome,
	PendingEgressConfirm,
} from "../core/egress-confirm-queue";

export interface EgressConfirmControlEndpoint {
	baseUrl: string;
	token: string;
}

export interface EgressConfirmControlClientOptions {
	fetchImpl?: typeof fetch;
	timeoutMs?: number;
}

function assertLoopbackEndpoint(endpoint: EgressConfirmControlEndpoint): URL {
	const url = new URL(endpoint.baseUrl);
	if (url.protocol !== "http:" || !["127.0.0.1", "::1", "[::1]"].includes(url.hostname)) {
		throw new Error("egress-confirm control endpoint must be HTTP on host loopback");
	}
	if (endpoint.token.length < 32) {
		throw new Error("egress-confirm control token is invalid");
	}
	return url;
}

function isPending(value: unknown): value is PendingEgressConfirm {
	if (!value || typeof value !== "object") return false;
	const record = value as Record<string, unknown>;
	return (
		typeof record.attemptId === "string" &&
		typeof record.host === "string" &&
		typeof record.port === "number" &&
		Number.isInteger(record.port) &&
		typeof record.role === "string" &&
		["architect", "worker", "reviewer"].includes(record.role) &&
		typeof record.requestedAt === "number" &&
		typeof record.expiresAt === "number"
	);
}

async function requestControl(
	endpoint: EgressConfirmControlEndpoint,
	path: string,
	init: RequestInit,
	options: EgressConfirmControlClientOptions,
): Promise<unknown> {
	const base = assertLoopbackEndpoint(endpoint);
	const fetchImpl = options.fetchImpl ?? fetch;
	const timeoutMs = options.timeoutMs ?? 3_000;
	const response = await fetchImpl(new URL(path, base), {
		...init,
		headers: {
			authorization: `Bearer ${endpoint.token}`,
			...(init.body ? { "content-type": "application/json" } : {}),
		},
		signal: AbortSignal.timeout(timeoutMs),
	});
	if (!response.ok) {
		throw new Error(`egress-confirm control request failed with HTTP ${response.status}`);
	}
	return await response.json();
}

export async function listPendingEgressConfirms(
	endpoint: EgressConfirmControlEndpoint,
	options: EgressConfirmControlClientOptions = {},
): Promise<PendingEgressConfirm[]> {
	const body = await requestControl(endpoint, "/egress-confirms", { method: "GET" }, options);
	const pending = (body as { pending?: unknown } | null)?.pending;
	if (!Array.isArray(pending) || !pending.every(isPending)) {
		throw new Error("egress-confirm control returned an invalid pending response");
	}
	return pending.map((entry) => ({ ...entry }));
}

const RESOLVE_OUTCOMES = new Set<EgressConfirmResolveOutcome>([
	"applied",
	"mismatch",
	"expired",
	"unknown",
	"already_resolved",
]);

export async function resolvePendingEgressConfirm(
	endpoint: EgressConfirmControlEndpoint,
	decision: EgressConfirmRequest & { approve: boolean },
	options: EgressConfirmControlClientOptions = {},
): Promise<EgressConfirmResolveOutcome> {
	const body = await requestControl(
		endpoint,
		"/egress-confirms/resolve",
		{ method: "POST", body: JSON.stringify(decision) },
		options,
	);
	const outcome = (body as { outcome?: unknown } | null)?.outcome;
	if (typeof outcome !== "string" || !RESOLVE_OUTCOMES.has(outcome as EgressConfirmResolveOutcome)) {
		throw new Error("egress-confirm control returned an invalid resolve response");
	}
	return outcome as EgressConfirmResolveOutcome;
}

/** Register one task credential inside the proxy process; the bearer-protected channel never reaches a sandbox. */
export async function issueEgressTaskIdentity(
	endpoint: EgressConfirmControlEndpoint,
	identity: { taskId: string; token: string },
	options: EgressConfirmControlClientOptions = {},
): Promise<void> {
	const body = await requestControl(
		endpoint,
		"/task-identities/issue",
		{ method: "POST", body: JSON.stringify(identity) },
		options,
	);
	if ((body as { outcome?: unknown } | null)?.outcome !== "applied") {
		throw new Error("egress control did not apply the task identity");
	}
}

/** Revoke one task credential before its sandbox placement is released. */
export async function revokeEgressTaskIdentity(
	endpoint: EgressConfirmControlEndpoint,
	taskId: string,
	options: EgressConfirmControlClientOptions = {},
): Promise<void> {
	const body = await requestControl(
		endpoint,
		"/task-identities/revoke",
		{ method: "POST", body: JSON.stringify({ taskId }) },
		options,
	);
	if ((body as { outcome?: unknown } | null)?.outcome !== "applied") {
		throw new Error("egress control did not revoke the task identity");
	}
}

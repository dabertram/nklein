/**
 * A flaky orders service with a rate limit and a clock you control. FROZEN: evidence, not workspace.
 *
 * It never throws and never sleeps. Time only moves when someone calls `advance(ms)`, so every retry, every
 * backoff and every rate-limit window in this fixture is exact rather than approximate — a retry test that
 * depends on wall time is a flaky test, and a flaky grader is worse than no grader.
 */

export const RATE_LIMIT = { maxRequests: 3, windowMs: 1000 };

export function createOrdersService() {
	const orders = new Map([
		["o1", { id: "o1", totalMinor: 1999, status: "paid" }],
		["o2", { id: "o2", totalMinor: 500, status: "pending" }],
	]);
	const calls = [];
	const scripted = [];
	const recentRequestTimes = [];
	let now = 0;
	let nextId = 3;

	function rateLimited() {
		while (recentRequestTimes.length > 0 && now - recentRequestTimes[0] >= RATE_LIMIT.windowMs) {
			recentRequestTimes.shift();
		}
		if (recentRequestTimes.length < RATE_LIMIT.maxRequests) {
			recentRequestTimes.push(now);
			return null;
		}
		const retryAfterMs = RATE_LIMIT.windowMs - (now - recentRequestTimes[0]);
		return {
			status: 429,
			body: { error: { code: "rate_limited", message: "too many requests" }, retryAfterMs },
		};
	}

	function route(method, path, body) {
		if (method === "GET" && path.startsWith("/orders/")) {
			const id = path.slice("/orders/".length);
			const found = orders.get(id);
			return found
				? { status: 200, body: { ...found } }
				: { status: 404, body: { error: { code: "not_found", message: `no order ${id}` } } };
		}
		if (method === "POST" && path === "/orders") {
			if (!Number.isInteger(body?.totalMinor) || body.totalMinor <= 0) {
				return { status: 422, body: { error: { code: "validation_failed", message: "totalMinor must be a positive integer", fields: ["totalMinor"] } } };
			}
			const created = { id: `o${nextId}`, totalMinor: body.totalMinor, status: "pending" };
			nextId += 1;
			orders.set(created.id, created);
			return { status: 201, body: { ...created } };
		}
		return { status: 404, body: { error: { code: "no_route", message: `${method} ${path}` } } };
	}

	function request(method, path, options) {
		calls.push({ method, path, atMs: now, body: options?.body ? { ...options.body } : null });
		// A SCRIPTED response overrides everything, including the rate limit, and does not consume a slot in the
		// window. Otherwise a retry case and the rate-limit case would interfere: four scripted 503s would turn into
		// three 503s and a 429 purely because the retries were fast, and the case would be testing the wrong thing.
		if (scripted.length > 0) {
			return scripted.shift();
		}
		const limited = rateLimited();
		if (limited) {
			return limited;
		}
		return route(method, path, options?.body ?? null);
	}

	return {
		request,
		/** Every call the adapter made, with the time it was made at. */
		calls: () => calls.map((call) => ({ ...call })),
		/** Move the clock. The conformance suite's fake `sleep` calls this, so waiting is exact. */
		advance: (ms) => {
			now += ms;
		},
		nowMs: () => now,
		/** Queue responses to be returned instead of routing, oldest first. Used to script failures. */
		queueResponses: (responses) => {
			scripted.push(...responses);
		},
	};
}

/** A 5xx that a well-behaved client should retry. */
export const transient = (status = 503) => ({
	status,
	body: { error: { code: "unavailable", message: "try again" } },
});

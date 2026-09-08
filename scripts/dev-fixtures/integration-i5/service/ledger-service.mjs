/**
 * The money side of the order: holds, captures and releases. FROZEN: evidence, not workspace.
 *
 * Deterministic, in-process, never throws. Every write is idempotent by key, because a distributed write that is
 * not idempotent cannot be retried, and a write that cannot be retried cannot be part of a saga.
 */

export function createLedgerService(options) {
	const availableMinor = options?.availableMinor ?? 100000;
	const holds = new Map();
	const byKey = new Map();
	const calls = [];
	const scripted = [];
	let nextId = 1;
	let reservedMinor = 0;

	const header = (headers, name) =>
		Object.entries(headers ?? {}).find(([key]) => key.toLowerCase() === name)?.[1];

	function createHold(body, headers) {
		const key = header(headers, "idempotency-key");
		if (typeof key !== "string" || key === "") {
			return { status: 400, body: { error: { code: "idempotency_key_required", message: "writes need a key" } } };
		}
		if (byKey.has(key)) {
			return { status: 200, body: { ...holds.get(byKey.get(key)) }, replayed: true };
		}
		if (!Number.isInteger(body?.amountMinor) || body.amountMinor <= 0) {
			return { status: 422, body: { error: { code: "validation_failed", message: "amountMinor must be a positive integer", fields: ["amountMinor"] } } };
		}
		if (reservedMinor + body.amountMinor > availableMinor) {
			return { status: 409, body: { error: { code: "insufficient_funds", message: "not enough available" } } };
		}
		const hold = { id: `h${nextId}`, amountMinor: body.amountMinor, state: "held" };
		nextId += 1;
		reservedMinor += hold.amountMinor;
		holds.set(hold.id, hold);
		byKey.set(key, hold.id);
		return { status: 201, body: { ...hold } };
	}

	function transition(id, from, to) {
		const hold = holds.get(id);
		if (!hold) {
			return { status: 404, body: { error: { code: "not_found", message: `no hold ${id}` } } };
		}
		// Idempotent: asking for a state it already has is a success, not a conflict.
		if (hold.state === to) {
			return { status: 200, body: { ...hold }, replayed: true };
		}
		if (hold.state !== from) {
			return { status: 409, body: { error: { code: "wrong_state", message: `hold ${id} is ${hold.state}` } } };
		}
		hold.state = to;
		if (to === "released") {
			reservedMinor -= hold.amountMinor;
		}
		return { status: 200, body: { ...hold } };
	}

	function request(method, path, options) {
		const headers = options?.headers ?? {};
		calls.push({ service: "ledger", method, path, headers: { ...headers }, body: options?.body ? { ...options.body } : null });
		if (scripted.length > 0) {
			return scripted.shift();
		}
		if (method === "POST" && path === "/holds") {
			return createHold(options?.body ?? null, headers);
		}
		if (method === "POST" && path.endsWith("/capture")) {
			return transition(path.slice("/holds/".length, -"/capture".length), "held", "captured");
		}
		if (method === "POST" && path.endsWith("/release")) {
			return transition(path.slice("/holds/".length, -"/release".length), "held", "released");
		}
		return { status: 404, body: { error: { code: "no_route", message: `${method} ${path}` } } };
	}

	return {
		request,
		calls: () => calls.map((call) => ({ ...call, headers: { ...call.headers } })),
		queueResponses: (responses) => scripted.push(...responses),
		holds: () => [...holds.values()].map((hold) => ({ ...hold })),
		reservedMinor: () => reservedMinor,
	};
}

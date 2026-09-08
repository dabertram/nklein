/**
 * An inventory API with a session, conditional reads and idempotent writes. FROZEN: evidence, not workspace.
 *
 * Deterministic, in-process, never throws, never sleeps. The clock moves only via `advance(ms)`, so token expiry
 * is exact. Every call is recorded WITH ITS HEADERS, because most of this contract is about what you send, not
 * what you get back: a conditional read that never sends `if-none-match` is not a conditional read, and an
 * idempotent write that sends a fresh key on every retry is not idempotent.
 */

const TOKEN_TTL_MS = 5000;

export function createInventoryService() {
	const items = new Map([
		["i1", { id: "i1", name: "bolt", quantity: 40, version: 1 }],
		["i2", { id: "i2", name: "nut", quantity: 12, version: 1 }],
	]);
	const calls = [];
	const scripted = [];
	const idempotency = new Map();
	let now = 0;
	let issuedToken = null;
	let tokenExpiresAtMs = 0;
	let tokenCounter = 0;
	let nextId = 3;

	const etagOf = (item) => `"v${item.version}"`;
	const header = (headers, name) => {
		const found = Object.entries(headers ?? {}).find(([key]) => key.toLowerCase() === name);
		return found ? found[1] : undefined;
	};

	function issueToken() {
		tokenCounter += 1;
		issuedToken = `tok-${tokenCounter}`;
		tokenExpiresAtMs = now + TOKEN_TTL_MS;
		return { status: 200, body: { token: issuedToken, expiresAtMs: tokenExpiresAtMs } };
	}

	function authorise(headers) {
		const presented = String(header(headers, "authorization") ?? "").replace(/^Bearer\s+/u, "");
		if (presented === "" || presented !== issuedToken) {
			return { status: 401, body: { error: { code: "unauthorized", message: "present a valid bearer token" } } };
		}
		if (now >= tokenExpiresAtMs) {
			return { status: 401, body: { error: { code: "token_expired", message: "the token has expired" } } };
		}
		return null;
	}

	function getItem(id, headers) {
		const item = items.get(id);
		if (!item) {
			return { status: 404, body: { error: { code: "not_found", message: `no item ${id}` } } };
		}
		if (header(headers, "if-none-match") === etagOf(item)) {
			return { status: 304, body: null, etag: etagOf(item) };
		}
		return { status: 200, body: { ...item }, etag: etagOf(item) };
	}

	function createItem(body, headers) {
		const key = header(headers, "idempotency-key");
		if (typeof key !== "string" || key === "") {
			return { status: 400, body: { error: { code: "idempotency_key_required", message: "writes need an Idempotency-Key" } } };
		}
		if (idempotency.has(key)) {
			return { status: 200, body: { ...idempotency.get(key) }, replayed: true };
		}
		if (typeof body?.name !== "string" || body.name.trim() === "" || !Number.isInteger(body?.quantity)) {
			return { status: 422, body: { error: { code: "validation_failed", message: "bad item", fields: ["name", "quantity"] } } };
		}
		const created = { id: `i${nextId}`, name: body.name, quantity: body.quantity, version: 1 };
		nextId += 1;
		items.set(created.id, created);
		idempotency.set(key, created);
		return { status: 201, body: { ...created } };
	}

	function request(method, path, options) {
		const headers = options?.headers ?? {};
		calls.push({ method, path, atMs: now, headers: { ...headers }, body: options?.body ? { ...options.body } : null });
		if (scripted.length > 0) {
			return scripted.shift();
		}
		if (method === "POST" && path === "/auth/token") {
			return issueToken();
		}
		const denied = authorise(headers);
		if (denied) {
			return denied;
		}
		if (method === "GET" && path.startsWith("/items/")) {
			return getItem(path.slice("/items/".length), headers);
		}
		if (method === "POST" && path === "/items") {
			return createItem(options?.body ?? null, headers);
		}
		return { status: 404, body: { error: { code: "no_route", message: `${method} ${path}` } } };
	}

	return {
		request,
		calls: () => calls.map((call) => ({ ...call, headers: { ...call.headers } })),
		advance: (ms) => {
			now += ms;
		},
		nowMs: () => now,
		queueResponses: (responses) => scripted.push(...responses),
		/** Change an item behind the client's back, so its etag moves. */
		bump: (id, changes) => {
			const item = items.get(id);
			items.set(id, { ...item, ...changes, version: item.version + 1 });
		},
		itemCount: () => items.size,
		tokenTtlMs: () => TOKEN_TTL_MS,
	};
}

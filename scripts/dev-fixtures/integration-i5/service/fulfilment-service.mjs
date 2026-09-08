/**
 * The goods side of the order: shipments. FROZEN: evidence, not workspace.
 *
 * Deterministic, in-process, never throws. Idempotent by key for the same reason the ledger is.
 */

export function createFulfilmentService(options) {
	const stock = new Map(Object.entries(options?.stock ?? { A: 2, B: 0 }));
	const shipments = new Map();
	const byKey = new Map();
	const calls = [];
	const scripted = [];
	let nextId = 1;

	const header = (headers, name) =>
		Object.entries(headers ?? {}).find(([key]) => key.toLowerCase() === name)?.[1];

	function createShipment(body, headers) {
		const key = header(headers, "idempotency-key");
		if (typeof key !== "string" || key === "") {
			return { status: 400, body: { error: { code: "idempotency_key_required", message: "writes need a key" } } };
		}
		if (byKey.has(key)) {
			return { status: 200, body: { ...shipments.get(byKey.get(key)) }, replayed: true };
		}
		if (typeof body?.sku !== "string" || body.sku === "") {
			return { status: 422, body: { error: { code: "validation_failed", message: "sku is required", fields: ["sku"] } } };
		}
		const remaining = stock.get(body.sku) ?? 0;
		if (remaining < 1) {
			return { status: 409, body: { error: { code: "out_of_stock", message: `no ${body.sku} left` } } };
		}
		stock.set(body.sku, remaining - 1);
		const shipment = { id: `s${nextId}`, sku: body.sku, state: "booked" };
		nextId += 1;
		shipments.set(shipment.id, shipment);
		byKey.set(key, shipment.id);
		return { status: 201, body: { ...shipment } };
	}

	function request(method, path, options) {
		const headers = options?.headers ?? {};
		calls.push({ service: "fulfilment", method, path, headers: { ...headers }, body: options?.body ? { ...options.body } : null });
		if (scripted.length > 0) {
			return scripted.shift();
		}
		if (method === "POST" && path === "/shipments") {
			return createShipment(options?.body ?? null, headers);
		}
		return { status: 404, body: { error: { code: "no_route", message: `${method} ${path}` } } };
	}

	return {
		request,
		calls: () => calls.map((call) => ({ ...call, headers: { ...call.headers } })),
		queueResponses: (responses) => scripted.push(...responses),
		shipments: () => [...shipments.values()].map((shipment) => ({ ...shipment })),
		stockOf: (sku) => stock.get(sku) ?? 0,
	};
}

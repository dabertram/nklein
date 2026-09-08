/**
 * An at-least-once event stream with server-side checkpoints. FROZEN: evidence, not workspace.
 *
 * Deterministic, in-process, never throws. Two things make it a real integration problem rather than a loop:
 *
 *  1. **At-least-once delivery.** Every batch after the first REPEATS the last event of the previous batch. That
 *     is not a bug to work around; it is what an at-least-once stream does, and a consumer that cannot tolerate it
 *     will double-process every boundary event. The repeat is deterministic so it can be graded exactly.
 *  2. **Checkpoints live on the server.** Progress survives the consumer, so "resume where you left off" is a real
 *     question with a checkable answer, and the ORDER of "process" versus "checkpoint" is observable in the call
 *     log — which is the difference between at-least-once and at-most-once.
 */

export const MAX_BATCH = 4;

const EVENTS = [
	{ id: "e1", seq: 1, type: "created", payload: { sku: "A" } },
	{ id: "e2", seq: 2, type: "priced", payload: { sku: "A", minor: 100 } },
	{ id: "e3", seq: 3, type: "created", payload: { sku: "B" } },
	{ id: "e4", seq: 4, type: "priced", payload: { sku: "B", minor: 250 } },
	{ id: "e5", seq: 5, type: "shipped", payload: { sku: "A" } },
	{ id: "e6", seq: 6, type: "created", payload: { sku: "C" } },
	{ id: "e7", seq: 7, type: "shipped", payload: { sku: "B" } },
];

export function createEventStreamService() {
	const calls = [];
	const checkpoints = new Map();
	const scripted = [];

	function readEvents(query) {
		const limit = Number(query.limit ?? MAX_BATCH);
		if (!Number.isInteger(limit) || limit < 1 || limit > MAX_BATCH) {
			return { status: 400, body: { error: { code: "bad_limit", message: `limit must be 1..${MAX_BATCH}` } } };
		}
		const after = query.after === undefined || query.after === null ? 0 : Number(query.after);
		if (!Number.isInteger(after) || after < 0) {
			return { status: 400, body: { error: { code: "bad_cursor", message: "after is not a sequence number" } } };
		}
		// AT-LEAST-ONCE: re-deliver the event at the cursor itself, not just the ones after it.
		const from = after === 0 ? 0 : EVENTS.findIndex((event) => event.seq === after);
		const slice = EVENTS.slice(from, from + limit).map((event) => ({ ...event, payload: { ...event.payload } }));
		const lastSeq = slice.length > 0 ? slice[slice.length - 1].seq : after;
		const more = EVENTS.some((event) => event.seq > lastSeq);
		return { status: 200, body: { events: slice, nextAfter: more ? String(lastSeq) : null } };
	}

	function request(method, path, options) {
		const query = options?.query ?? {};
		const body = options?.body ?? null;
		calls.push({ method, path, query: { ...query }, body: body ? { ...body } : null });
		if (scripted.length > 0) {
			return scripted.shift();
		}
		if (method === "GET" && path === "/events") {
			return readEvents(query);
		}
		if (method === "GET" && path.startsWith("/checkpoints/")) {
			const consumer = path.slice("/checkpoints/".length);
			return checkpoints.has(consumer)
				? { status: 200, body: { consumer, after: checkpoints.get(consumer) } }
				: { status: 404, body: { error: { code: "not_found", message: `no checkpoint for ${consumer}` } } };
		}
		if (method === "PUT" && path.startsWith("/checkpoints/")) {
			const consumer = path.slice("/checkpoints/".length);
			if (typeof body?.after !== "string" || body.after === "") {
				return { status: 422, body: { error: { code: "validation_failed", message: "after must be a string", fields: ["after"] } } };
			}
			checkpoints.set(consumer, body.after);
			return { status: 200, body: { consumer, after: body.after } };
		}
		return { status: 404, body: { error: { code: "no_route", message: `${method} ${path}` } } };
	}

	return {
		request,
		calls: () => calls.map((call) => ({ ...call, query: { ...call.query }, body: call.body ? { ...call.body } : null })),
		queueResponses: (responses) => scripted.push(...responses),
		/** Every event in the stream, in order — for a case that needs to know what "all of them" means. */
		allEvents: () => EVENTS.map((event) => ({ ...event, payload: { ...event.payload } })),
		checkpointOf: (consumer) => checkpoints.get(consumer) ?? null,
		setCheckpoint: (consumer, after) => checkpoints.set(consumer, after),
	};
}

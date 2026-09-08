/**
 * The service your adapter talks to. FROZEN: evidence, not workspace.
 *
 * It is deterministic and in-process — there is no network here and never will be. It behaves like a small HTTP
 * API: every call returns `{ status, body }` and NEVER throws for an error status. Turning a status into an
 * outcome is the adapter's job, which is the whole point of the exercise.
 *
 * It also records every call it receives, so a conformance case can check HOW the adapter talked to it and not
 * merely what it returned. An adapter that fetches the whole world and filters locally gets a different answer
 * from one that pages properly, and both look identical from the outside.
 */

const SEED_CONTACTS = [
	{ id: "c1", name: "Ada", email: "ada@example.com" },
	{ id: "c2", name: "Bo", email: "bo@example.com" },
	{ id: "c3", name: "Cy", email: "cy@example.com" },
	{ id: "c4", name: "Dee", email: "dee@example.com" },
	{ id: "c5", name: "Eli", email: "eli@example.com" },
	{ id: "c6", name: "Fay", email: "fay@example.com" },
	{ id: "c7", name: "Gus", email: "gus@example.com" },
];

export const MAX_PAGE_SIZE = 3;

export function createContactsService() {
	const contacts = SEED_CONTACTS.map((contact) => ({ ...contact }));
	const calls = [];
	let forced = null;
	let nextId = contacts.length + 1;

	function request(method, path, options) {
		const query = options?.query ?? {};
		const body = options?.body ?? null;
		calls.push({ method, path, query: { ...query }, body: body ? { ...body } : null });
		if (forced) {
			const response = forced;
			forced = null;
			return response;
		}
		if (method === "GET" && path === "/contacts") {
			return listContacts(query);
		}
		if (method === "GET" && path.startsWith("/contacts/")) {
			return getContact(path.slice("/contacts/".length));
		}
		if (method === "POST" && path === "/contacts") {
			return createContact(body);
		}
		return { status: 404, body: { error: { code: "no_route", message: `${method} ${path}` } } };
	}

	function listContacts(query) {
		const limit = Number(query.limit ?? MAX_PAGE_SIZE);
		if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PAGE_SIZE) {
			return { status: 400, body: { error: { code: "bad_limit", message: `limit must be 1..${MAX_PAGE_SIZE}` } } };
		}
		const cursor = query.cursor === undefined || query.cursor === null ? 0 : Number(query.cursor);
		if (!Number.isInteger(cursor) || cursor < 0 || cursor > contacts.length) {
			return { status: 400, body: { error: { code: "bad_cursor", message: "cursor is not a position" } } };
		}
		const page = contacts.slice(cursor, cursor + limit).map((contact) => ({ ...contact }));
		const next = cursor + page.length;
		return { status: 200, body: { items: page, nextCursor: next < contacts.length ? String(next) : null } };
	}

	function getContact(id) {
		const found = contacts.find((contact) => contact.id === id);
		return found
			? { status: 200, body: { ...found } }
			: { status: 404, body: { error: { code: "not_found", message: `no contact ${id}` } } };
	}

	function createContact(body) {
		const fields = [];
		if (typeof body?.name !== "string" || body.name.trim() === "") fields.push("name");
		if (typeof body?.email !== "string" || !body.email.includes("@")) fields.push("email");
		if (fields.length > 0) {
			return { status: 422, body: { error: { code: "validation_failed", message: "bad contact", fields } } };
		}
		const created = { id: `c${nextId}`, name: body.name, email: body.email };
		nextId += 1;
		contacts.push(created);
		return { status: 201, body: { ...created } };
	}

	return {
		request,
		/** Every call the adapter made, oldest first. */
		calls: () => calls.map((call) => ({ ...call, query: { ...call.query } })),
		/** Make the NEXT request return this response, whatever it asks for. Used to exercise error paths. */
		forceNext: (response) => {
			forced = response;
		},
		/** The seed data, for a case that needs to know what "all of them" means. */
		seeded: () => contacts.map((contact) => ({ ...contact })),
	};
}

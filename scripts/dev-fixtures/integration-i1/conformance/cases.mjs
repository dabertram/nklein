/**
 * The conformance suite your adapter is graded against. FROZEN: evidence, not workspace.
 *
 * Each case builds a FRESH service and a fresh adapter, so no case can be affected by another. A case asserts the
 * adapter's OUTCOME and, where it matters, the CALLS it made — an adapter that fetches everything and filters
 * locally returns the right answer for the wrong reason, and only the call log can tell the difference.
 */

export const cases = [
	{
		id: "C01",
		title: "listAll returns every contact, in service order",
		run: async (makeClient, service, assert) => {
			const client = makeClient(service);
			assert.deepEqual(await client.listAll(), service.seeded());
		},
	},
	{
		id: "C02",
		title: "listAll pages: it never asks for more than the page size, and it follows the cursor",
		run: async (makeClient, service, assert) => {
			const client = makeClient(service);
			await client.listAll();
			const listCalls = service.calls().filter((call) => call.path === "/contacts" && call.method === "GET");
			assert.ok(listCalls.length >= 3, `7 contacts at ${3} per page needs at least 3 calls, saw ${listCalls.length}`);
			for (const call of listCalls) {
				const limit = Number(call.query.limit ?? 3);
				assert.ok(limit >= 1 && limit <= 3, `limit ${limit} is outside the service's 1..3`);
			}
			// The first call must not carry a cursor; every later one must.
			assert.equal(listCalls[0].query.cursor ?? null, null, "the first page must not send a cursor");
			for (const call of listCalls.slice(1)) {
				assert.notEqual(call.query.cursor ?? null, null, "a later page must send the cursor it was given");
			}
		},
	},
	{
		id: "C03",
		title: "listAll stops when the service says there is no next cursor",
		run: async (makeClient, service, assert) => {
			const client = makeClient(service);
			await client.listAll();
			const before = service.calls().length;
			await client.listAll();
			const perRun = service.calls().length - before;
			assert.ok(perRun <= 4, `a full listing of 7 contacts should take 3 calls, took ${perRun} — it did not stop`);
		},
	},
	{
		id: "C04",
		title: "get returns the contact",
		run: async (makeClient, service, assert) => {
			const client = makeClient(service);
			assert.deepEqual(await client.get("c3"), { id: "c3", name: "Cy", email: "cy@example.com" });
		},
	},
	{
		id: "C05",
		title: "get returns null for a contact that does not exist — a 404 is an answer, not a failure",
		run: async (makeClient, service, assert) => {
			const client = makeClient(service);
			assert.equal(await client.get("nope"), null);
		},
	},
	{
		id: "C06",
		title: "create returns the created contact and it is then retrievable",
		run: async (makeClient, service, assert) => {
			const client = makeClient(service);
			const created = await client.create({ name: "Hal", email: "hal@example.com" });
			assert.equal(created.name, "Hal");
			assert.equal(typeof created.id, "string");
			assert.deepEqual(await client.get(created.id), created);
		},
	},
	{
		id: "C07",
		title: "create rejects an invalid contact with a ValidationError naming the fields",
		run: async (makeClient, service, assert) => {
			const client = makeClient(service);
			await assert.rejects(
				() => client.create({ name: "", email: "not-an-email" }),
				(error) => {
					assert.equal(error.name, "ValidationError", `expected a ValidationError, got ${error.name}`);
					assert.deepEqual([...(error.fields ?? [])].sort(), ["email", "name"]);
					return true;
				},
			);
		},
	},
	{
		id: "C08",
		title: "any other error status becomes a ServiceError carrying the status and the service's error code",
		run: async (makeClient, service, assert) => {
			const client = makeClient(service);
			service.forceNext({ status: 503, body: { error: { code: "unavailable", message: "try later" } } });
			await assert.rejects(
				() => client.get("c1"),
				(error) => {
					assert.equal(error.name, "ServiceError", `expected a ServiceError, got ${error.name}`);
					assert.equal(error.status, 503);
					assert.equal(error.code, "unavailable");
					return true;
				},
			);
		},
	},
	{
		id: "C09",
		title: "a failure while listing is not swallowed into a short list",
		run: async (makeClient, service, assert) => {
			const client = makeClient(service);
			service.forceNext({ status: 500, body: { error: { code: "boom", message: "oops" } } });
			await assert.rejects(() => client.listAll(), (error) => error.name === "ServiceError" && error.status === 500);
		},
	},
];

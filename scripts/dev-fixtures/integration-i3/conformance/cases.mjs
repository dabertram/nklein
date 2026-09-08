/**
 * The conformance suite. FROZEN: evidence, not workspace.
 *
 * Most of this contract is about what the adapter SENDS, so most cases read the service's call log. A fresh
 * service and adapter per case; `sleep` records the wait and advances the service's clock.
 */

const authCalls = (service) => service.calls().filter((call) => call.path === "/auth/token");
const itemCalls = (service) => service.calls().filter((call) => call.path.startsWith("/items"));
const headerOf = (call, name) =>
	Object.entries(call.headers ?? {}).find(([key]) => key.toLowerCase() === name)?.[1];

export const cases = [
	{
		id: "C01",
		title: "the first call gets a token and then makes the request with it",
		run: async (makeClient, service, sleeps, assert) => {
			const client = makeClient(service);
			assert.deepEqual(await client.getItem("i1"), { id: "i1", name: "bolt", quantity: 40, version: 1 });
			assert.equal(authCalls(service).length, 1, "exactly one token request");
			const [request] = itemCalls(service);
			assert.match(String(headerOf(request, "authorization") ?? ""), /^Bearer tok-1$/u);
		},
	},
	{
		id: "C02",
		title: "a valid token is reused — three reads authenticate once",
		run: async (makeClient, service, sleeps, assert) => {
			const client = makeClient(service);
			await client.getItem("i1");
			await client.getItem("i2");
			await client.getItem("i2");
			assert.equal(authCalls(service).length, 1, "the token must be kept, not re-fetched per call");
		},
	},
	{
		id: "C03",
		title: "a 401 refreshes the token once and retries the request",
		run: async (makeClient, service, sleeps, assert) => {
			const client = makeClient(service);
			await client.getItem("i1");
			// The token is revoked behind the client's back: the next call it makes will be rejected.
			service.queueResponses([{ status: 401, body: { error: { code: "token_expired", message: "expired" } } }]);
			assert.equal((await client.getItem("i2")).id, "i2");
			assert.equal(authCalls(service).length, 2, "one refresh, not zero and not two");
		},
	},
	{
		id: "C04",
		title: "a second 401 after refreshing gives up instead of looping",
		run: async (makeClient, service, sleeps, assert) => {
			const client = makeClient(service);
			const denied = { status: 401, body: { error: { code: "unauthorized", message: "no" } } };
			service.queueResponses([
				{ status: 200, body: { token: "tok-x", expiresAtMs: 999999 } },
				denied,
				{ status: 200, body: { token: "tok-y", expiresAtMs: 999999 } },
				denied,
				denied,
				denied,
			]);
			await assert.rejects(
				() => client.getItem("i1"),
				(error) => {
					assert.equal(error.name, "ServiceError", `expected a ServiceError, got ${error.name}`);
					assert.equal(error.status, 401);
					return true;
				},
			);
			assert.ok(authCalls(service).length <= 2, `at most one refresh, saw ${authCalls(service).length} token calls`);
		},
	},
	{
		id: "C05",
		title: "an expired token is refreshed before the call, not after a rejection",
		run: async (makeClient, service, sleeps, assert) => {
			const client = makeClient(service);
			await client.getItem("i1");
			service.advance(service.tokenTtlMs());
			await client.getItem("i2");
			assert.equal(authCalls(service).length, 2, "the client knew the token had expired");
			// Nothing should have been rejected: the refresh happened before the request went out.
			assert.equal(
				itemCalls(service).length,
				2,
				"a proactive refresh means two item calls, not three (one rejected, one retried)",
			);
		},
	},
	{
		id: "C06",
		title: "a repeated read sends If-None-Match and a 304 returns the cached item",
		run: async (makeClient, service, sleeps, assert) => {
			const client = makeClient(service);
			const first = await client.getItem("i1");
			const second = await client.getItem("i1");
			assert.deepEqual(second, first, "a 304 must return the cached body, not null");
			const reads = itemCalls(service).filter((call) => call.method === "GET");
			assert.equal(headerOf(reads[0], "if-none-match"), undefined, "nothing is cached before the first read");
			assert.equal(headerOf(reads[1], "if-none-match"), '"v1"', "the second read must send the etag it was given");
		},
	},
	{
		id: "C07",
		title: "a changed item is refetched, not served stale from the cache",
		run: async (makeClient, service, sleeps, assert) => {
			const client = makeClient(service);
			await client.getItem("i1");
			service.bump("i1", { quantity: 41 });
			const after = await client.getItem("i1");
			assert.equal(after.quantity, 41, "the etag moved, so the service returned 200 and the cache must update");
			assert.equal(after.version, 2);
			const third = await client.getItem("i1");
			assert.deepEqual(third, after, "and the new value is what the cache now holds");
		},
	},
	{
		id: "C08",
		title: "a write sends an Idempotency-Key",
		run: async (makeClient, service, sleeps, assert) => {
			const client = makeClient(service);
			const created = await client.createItem({ name: "washer", quantity: 5 });
			assert.equal(created.name, "washer");
			const [write] = itemCalls(service).filter((call) => call.method === "POST");
			const key = headerOf(write, "idempotency-key");
			assert.equal(typeof key, "string");
			assert.notEqual(key, "", "the key must be a real value");
		},
	},
	{
		id: "C09",
		title: "a retried write reuses the SAME key, so the item is created once",
		run: async (makeClient, service, sleeps, assert) => {
			const client = makeClient(service);
			// Warm the session first: a queued response is taken by whatever call comes next, and on a cold client
			// that would be the token request rather than the write we mean to fail.
			await client.getItem("i1");
			const before = service.itemCount();
			service.queueResponses([{ status: 503, body: { error: { code: "unavailable", message: "later" } } }]);
			const created = await client.createItem({ name: "spring", quantity: 9 });
			assert.equal(created.name, "spring");
			const writes = itemCalls(service).filter((call) => call.method === "POST");
			assert.equal(writes.length, 2, "one failed attempt and one retry");
			assert.equal(
				headerOf(writes[0], "idempotency-key"),
				headerOf(writes[1], "idempotency-key"),
				"a retry that mints a fresh key is not idempotent — that is how duplicates are created",
			);
			assert.equal(service.itemCount(), before + 1, "exactly one item was created");
		},
	},
	{
		id: "C10",
		title: "two different writes use different keys",
		run: async (makeClient, service, sleeps, assert) => {
			const client = makeClient(service);
			await client.createItem({ name: "clip", quantity: 2 });
			await client.createItem({ name: "pin", quantity: 3 });
			const writes = itemCalls(service).filter((call) => call.method === "POST");
			assert.notEqual(
				headerOf(writes[0], "idempotency-key"),
				headerOf(writes[1], "idempotency-key"),
				"reusing one key across different writes would replay the first item forever",
			);
			assert.equal(service.itemCount(), 4);
		},
	},
];

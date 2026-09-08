/**
 * The conformance suite. FROZEN: evidence, not workspace.
 *
 * Every case gets a fresh service and a fresh adapter, and a `sleep` that does not sleep: it records the wait and
 * advances the service's clock instead. So a retry that "waits 1 second" costs nothing and is checked exactly.
 */

export const cases = [
	{
		id: "C01",
		title: "a transient 5xx is retried and the call then succeeds",
		run: async (makeClient, service, sleeps, assert) => {
			const { transient } = await import("../service/orders-service.mjs");
			service.queueResponses([transient()]);
			const client = makeClient(service);
			assert.deepEqual(await client.getOrder("o1"), { id: "o1", totalMinor: 1999, status: "paid" });
			assert.equal(service.calls().length, 2, "one failure and one success is two calls");
			assert.equal(sleeps.length, 1, "exactly one wait between the two attempts");
		},
	},
	{
		id: "C02",
		title: "retries are bounded: four failures give up with a ServiceError naming the attempts",
		run: async (makeClient, service, sleeps, assert) => {
			const { transient } = await import("../service/orders-service.mjs");
			service.queueResponses([transient(), transient(), transient(), transient(), transient()]);
			const client = makeClient(service);
			await assert.rejects(
				() => client.getOrder("o1"),
				(error) => {
					assert.equal(error.name, "ServiceError", `expected a ServiceError, got ${error.name}`);
					assert.equal(error.status, 503);
					assert.equal(error.attempts, 4, "the default budget is 4 attempts in total");
					return true;
				},
			);
			assert.equal(service.calls().length, 4, "four attempts means four calls, not five");
			assert.equal(sleeps.length, 3, "three waits between four attempts");
		},
	},
	{
		id: "C03",
		title: "a 404 is not retried — it is an answer",
		run: async (makeClient, service, sleeps, assert) => {
			const client = makeClient(service);
			assert.equal(await client.getOrder("missing"), null);
			assert.equal(service.calls().length, 1, "a 404 must be answered on the first call");
			assert.deepEqual(sleeps, []);
		},
	},
	{
		id: "C04",
		title: "a 422 is not retried and rejects with a ValidationError naming the fields",
		run: async (makeClient, service, sleeps, assert) => {
			const client = makeClient(service);
			await assert.rejects(
				() => client.createOrder({ totalMinor: 0 }),
				(error) => {
					assert.equal(error.name, "ValidationError", `expected a ValidationError, got ${error.name}`);
					assert.deepEqual(error.fields, ["totalMinor"]);
					return true;
				},
			);
			assert.equal(service.calls().length, 1, "a client error must not be retried");
			assert.deepEqual(sleeps, []);
		},
	},
	{
		id: "C05",
		title: "a 429 waits exactly the retryAfterMs the service asked for, not the backoff schedule",
		run: async (makeClient, service, sleeps, assert) => {
			const client = makeClient(service);
			// Fill the window: three calls are allowed, the fourth is rate limited.
			await client.getOrder("o1");
			await client.getOrder("o1");
			await client.getOrder("o1");
			const before = service.calls().length;
			assert.deepEqual(sleeps, [], "nothing has been rate limited yet");
			assert.deepEqual(await client.getOrder("o2"), { id: "o2", totalMinor: 500, status: "pending" });
			assert.equal(sleeps.length, 1, "one rate-limit wait");
			assert.equal(sleeps[0], 1000, "the wait must be the retryAfterMs the service sent, exactly");
			assert.equal(service.calls().length, before + 2, "the limited call and the retry");
		},
	},
	{
		id: "C06",
		title: "5xx backoff doubles from the base delay, and is never longer than needed",
		run: async (makeClient, service, sleeps, assert) => {
			const { transient } = await import("../service/orders-service.mjs");
			service.queueResponses([transient(), transient(), transient()]);
			const client = makeClient(service);
			await client.getOrder("o1");
			assert.deepEqual(sleeps, [100, 200, 400], "the default schedule is 100ms doubling per retry");
		},
	},
	{
		id: "C07",
		title: "a call that succeeds first time never waits",
		run: async (makeClient, service, sleeps, assert) => {
			const client = makeClient(service);
			await client.getOrder("o1");
			assert.deepEqual(sleeps, []);
			assert.equal(service.calls().length, 1);
		},
	},
	{
		id: "C08",
		title: "the attempt budget and base delay are configurable",
		run: async (makeClient, service, sleeps, assert) => {
			const { transient } = await import("../service/orders-service.mjs");
			service.queueResponses([transient(), transient(), transient(), transient()]);
			const client = makeClient(service, { maxAttempts: 2, baseDelayMs: 25 });
			await assert.rejects(() => client.getOrder("o1"), (error) => error.attempts === 2);
			assert.equal(service.calls().length, 2);
			assert.deepEqual(sleeps, [25]);
		},
	},
	{
		id: "C09",
		title: "createOrder retries a transient failure too — the policy is the client's, not the method's",
		run: async (makeClient, service, sleeps, assert) => {
			const { transient } = await import("../service/orders-service.mjs");
			service.queueResponses([transient(500)]);
			const client = makeClient(service);
			const created = await client.createOrder({ totalMinor: 750 });
			assert.equal(created.totalMinor, 750);
			assert.equal(created.status, "pending");
			assert.equal(sleeps.length, 1);
		},
	},
];

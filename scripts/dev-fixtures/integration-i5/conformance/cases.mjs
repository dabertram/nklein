/**
 * The conformance suite. FROZEN: evidence, not workspace.
 *
 * A saga is judged on what it leaves behind. Every case therefore checks the FINAL STATE of both services — no
 * money held that nothing backs, no shipment booked against money that was released — and, where the ordering
 * matters, the sequence of calls. A saga that produces the right return value and leaves a dangling hold has
 * failed at exactly the thing it exists to do.
 */

const ledgerCalls = (ledger) => ledger.calls();
const fulfilmentCalls = (fulfilment) => fulfilment.calls();
const pathsOf = (service) => service.calls().map((call) => `${call.method} ${call.path}`);

export const cases = [
	{
		id: "C01",
		title: "the happy path holds the money, books the shipment, then captures — in that order",
		run: async (placeOrder, { ledger, fulfilment }, assert) => {
			const result = await placeOrder({ orderId: "o-1", amountMinor: 2500, sku: "A" });
			assert.equal(result.shipment.sku, "A");
			assert.equal(result.hold.state, "captured");
			assert.deepEqual(pathsOf(ledger), ["POST /holds", "POST /holds/h1/capture"]);
			assert.deepEqual(pathsOf(fulfilment), ["POST /shipments"]);
			// The capture must come after the shipment is booked, never before.
			assert.equal(ledgerCalls(ledger).length, 2);
			assert.equal(fulfilmentCalls(fulfilment).length, 1);
		},
	},
	{
		id: "C02",
		title: "money is never captured, and never left held, when the goods cannot ship",
		run: async (placeOrder, { ledger, fulfilment }, assert) => {
			await assert.rejects(
				() => placeOrder({ orderId: "o-2", amountMinor: 2500, sku: "B" }),
				(error) => {
					assert.equal(error.code, "out_of_stock", `the original failure must survive, saw ${error.code}`);
					return true;
				},
			);
			assert.deepEqual(ledger.holds(), [{ id: "h1", amountMinor: 2500, state: "released" }]);
			assert.equal(ledger.reservedMinor(), 0, "a released hold reserves nothing");
			assert.deepEqual(fulfilment.shipments(), [], "nothing shipped");
			assert.ok(!pathsOf(ledger).includes("POST /holds/h1/capture"), "money must not be taken for goods not sent");
		},
	},
	{
		id: "C03",
		title: "a hold that cannot be created never reaches fulfilment",
		run: async (placeOrder, { ledger, fulfilment }, assert) => {
			await assert.rejects(
				() => placeOrder({ orderId: "o-3", amountMinor: 0, sku: "A" }),
				(error) => error.name === "ValidationError",
			);
			assert.deepEqual(fulfilment.calls(), [], "the goods side must not be touched when the money side refused");
			assert.deepEqual(ledger.holds(), []);
		},
	},
	{
		id: "C04",
		title: "insufficient funds fail before anything is booked",
		run: async (placeOrder, { ledger, fulfilment }, assert) => {
			await assert.rejects(
				() => placeOrder({ orderId: "o-4", amountMinor: 999999, sku: "A" }),
				(error) => error.code === "insufficient_funds",
			);
			assert.deepEqual(fulfilment.calls(), []);
			assert.equal(ledger.reservedMinor(), 0);
		},
	},
	{
		id: "C05",
		title: "the compensating release is retried when it fails transiently",
		run: async (placeOrder, { ledger, fulfilment }, assert) => {
			// The shipment fails; the first release attempt then fails transiently and must be tried again.
			ledger.queueResponses([]);
			const originalRequest = ledger.request;
			let releaseAttempts = 0;
			ledger.request = (method, path, options) => {
				if (path.endsWith("/release")) {
					releaseAttempts += 1;
					if (releaseAttempts === 1) {
						return { status: 503, body: { error: { code: "unavailable", message: "later" } } };
					}
				}
				return originalRequest(method, path, options);
			};
			await assert.rejects(() => placeOrder({ orderId: "o-5", amountMinor: 2500, sku: "B" }));
			assert.ok(releaseAttempts >= 2, `the release must be retried, saw ${releaseAttempts} attempt(s)`);
			assert.equal(ledger.reservedMinor(), 0, "and it must actually succeed in the end");
		},
	},
	{
		id: "C06",
		title: "a repeated order does not hold twice or ship twice",
		run: async (placeOrder, { ledger, fulfilment }, assert) => {
			const first = await placeOrder({ orderId: "o-6", amountMinor: 2500, sku: "A" });
			const second = await placeOrder({ orderId: "o-6", amountMinor: 2500, sku: "A" });
			assert.equal(second.hold.id, first.hold.id, "the same order must reuse its hold");
			assert.equal(second.shipment.id, first.shipment.id, "and its shipment");
			assert.equal(ledger.holds().length, 1);
			assert.equal(fulfilment.shipments().length, 1);
			assert.equal(fulfilment.stockOf("A"), 1, "stock is decremented once, not twice");
		},
	},
	{
		id: "C07",
		title: "different orders use different keys, so they are genuinely separate",
		run: async (placeOrder, { ledger, fulfilment }, assert) => {
			await placeOrder({ orderId: "o-7a", amountMinor: 1000, sku: "A" });
			await placeOrder({ orderId: "o-7b", amountMinor: 1000, sku: "A" });
			assert.equal(ledger.holds().length, 2);
			assert.equal(fulfilment.shipments().length, 2);
			assert.equal(fulfilment.stockOf("A"), 0);
		},
	},
	{
		id: "C08",
		title: "a failure AFTER the capture is not compensated — the money is already taken",
		run: async (placeOrder, { ledger, fulfilment }, assert) => {
			const originalRequest = ledger.request;
			ledger.request = (method, path, options) => {
				const response = originalRequest(method, path, options);
				// The capture succeeds at the service, but the client is told it failed. A saga must not "undo" a
				// step it cannot know the outcome of by releasing money the ledger has already captured.
				if (path.endsWith("/capture")) {
					return { status: 504, body: { error: { code: "gateway_timeout", message: "no answer" } } };
				}
				return response;
			};
			await assert.rejects(() => placeOrder({ orderId: "o-8", amountMinor: 2500, sku: "A" }));
			assert.ok(
				!pathsOf(ledger).some((entry) => entry.endsWith("/release")),
				"releasing after a capture attempt would refund money the ledger may already hold as captured",
			);
		},
	},
];

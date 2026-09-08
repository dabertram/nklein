/**
 * The behaviour this refactor must preserve, exactly. FROZEN: evidence, not workspace.
 *
 * Each scenario asserts against values derived here from the rules as the brief documents them, never against a
 * snapshot of what the current code happens to return.
 */

const line = (quantity, unitMinor) => ({ quantity, unitMinor });
const order = (over = {}) => ({ id: "o-1", lines: [line(2, 250)], address: "1 Main St", ...over });

export const scenarios = [
	{
		id: "B01",
		title: "an order is payable at or above 100 minor units, with whole positive lines",
		entry: "orderIsPayable",
		assert: (orderIsPayable, assert) => {
			assert.equal(orderIsPayable(order({ lines: [line(1, 100)] })), true);
			assert.equal(orderIsPayable(order({ lines: [line(1, 99)] })), false);
			assert.equal(orderIsPayable(order({ lines: [line(2, 50)] })), true);
			// Fractional or non-positive quantities are not orders, whatever they total.
			assert.equal(orderIsPayable(order({ lines: [line(1.5, 200)] })), false);
			assert.equal(orderIsPayable(order({ lines: [line(0, 200)] })), false);
			assert.equal(orderIsPayable(order({ lines: [line(1, -200)] })), false);
			assert.equal(orderIsPayable(order({ lines: [] })), false);
			assert.equal(orderIsPayable(null), false);
		},
	},
	{
		id: "B02",
		title: "the total is the plain sum of the lines, in minor units",
		entry: "orderTotalMinor",
		assert: (orderTotalMinor, assert) => {
			assert.equal(orderTotalMinor(order({ lines: [line(2, 250), line(1, 99)] })), 599);
			assert.equal(orderTotalMinor(order({ lines: [] })), 0);
			assert.equal(orderTotalMinor(null), 0);
		},
	},
	{
		id: "B03",
		title: "a shipment is released only for a payable order that has an address",
		entry: "shipmentStateFor",
		assert: (shipmentStateFor, assert) => {
			assert.equal(shipmentStateFor(order()), "released");
			assert.equal(shipmentStateFor(order({ address: null })), "pending");
			assert.equal(shipmentStateFor(order({ lines: [line(1, 10)] })), "held");
			assert.equal(shipmentStateFor(order({ lines: [] })), "held");
			assert.equal(shipmentStateFor(null), "held");
		},
	},
	{
		id: "B04",
		title: "a shipment description carries its state and line count",
		entry: "describeShipment",
		assert: (describeShipment, assert) => {
			assert.equal(describeShipment(order()), "released:1");
			assert.equal(describeShipment(order({ address: null, lines: [line(1, 100), line(1, 100)] })), "pending:2");
		},
	},
	{
		id: "B05",
		title: "saving an order stores a derived record, and loading returns it",
		entry: "saveOrder",
		assert: async (saveOrder, assert) => {
			const { loadOrder, reset } = await import("../src/index.mjs");
			reset();
			const saved = saveOrder(order({ id: "o-42", lines: [line(2, 250)] }));
			assert.deepEqual(saved, {
				id: "o-42",
				lines: [line(2, 250)],
				address: "1 Main St",
				totalMinor: 500,
				payable: true,
				shipment: "released:1",
			});
			assert.deepEqual(loadOrder("o-42"), saved);
		},
	},
	{
		id: "B06",
		title: "an order without an id cannot be saved, and an unknown id cannot be loaded",
		entry: "saveOrder",
		assert: async (saveOrder, assert) => {
			const { loadOrder, reset } = await import("../src/index.mjs");
			reset();
			assert.throws(() => saveOrder(order({ id: undefined })), TypeError);
			assert.throws(() => loadOrder("missing"), (error) => error instanceof RangeError && /missing/u.test(error.message));
		},
	},
	{
		id: "B07",
		title: "the summary reads back every derived field in order",
		entry: "summariseOrder",
		assert: async (summariseOrder, assert) => {
			const { saveOrder, reset } = await import("../src/index.mjs");
			reset();
			saveOrder(order({ id: "o-7", lines: [line(2, 250), line(1, 99)] }));
			assert.equal(summariseOrder("o-7"), "order o-7, 2 line(s), 599 minor, payable, shipment released:2");
			reset();
			saveOrder(order({ id: "o-8", lines: [line(1, 10)], address: null }));
			assert.equal(summariseOrder("o-8"), "order o-8, 1 line(s), 10 minor, not payable, shipment held:1");
		},
	},
];

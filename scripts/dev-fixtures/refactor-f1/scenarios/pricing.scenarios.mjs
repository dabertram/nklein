/**
 * The behaviour this refactor must preserve, exactly. FROZEN: this file is evidence, not workspace.
 *
 * Each scenario names the export it drives and asserts against values computed here, in the scenario, from the
 * rules as they are documented in the brief — not against a snapshot of whatever the current code happens to
 * return. A characterization suite that snapshots the implementation would bless a bug as behaviour.
 */

const order = (over = {}) => ({
	region: "row",
	loyaltyTier: "none",
	shippingSpeed: "standard",
	lines: [{ sku: "A", quantity: 1, unitPrice: 100 }],
	...over,
});

export const scenarios = [
	{
		id: "B01",
		title: "a small order takes no discount and pays flat shipping",
		entry: "applyOrderPricing",
		assert: (applyOrderPricing, assert) => {
			const result = applyOrderPricing(order());
			assert.equal(result.subtotal, 100);
			assert.equal(result.discountRate, 0);
			assert.equal(result.taxable, 100);
			assert.equal(result.shipping, 12.5);
			assert.equal(result.total, 112.5);
		},
	},
	{
		id: "B02",
		title: "the volume ladder steps at 200, 500 and 1000",
		entry: "applyOrderPricing",
		assert: (applyOrderPricing, assert) => {
			const rateAt = (subtotal) => applyOrderPricing(order({ lines: [{ sku: "A", quantity: 1, unitPrice: subtotal }] })).discountRate;
			assert.equal(rateAt(199), 0);
			assert.equal(rateAt(200), 0.05);
			assert.equal(rateAt(499), 0.05);
			assert.equal(rateAt(500), 0.1);
			assert.equal(rateAt(999), 0.1);
			assert.equal(rateAt(1000), 0.15);
		},
	},
	{
		id: "B03",
		title: "loyalty adds to the volume rate and the sum is capped at 20%",
		entry: "applyOrderPricing",
		assert: (applyOrderPricing, assert) => {
			const gold = order({ loyaltyTier: "gold", lines: [{ sku: "A", quantity: 1, unitPrice: 300 }] });
			assert.equal(applyOrderPricing(gold).discountRate, 0.1);
			const silver = order({ loyaltyTier: "silver", lines: [{ sku: "A", quantity: 1, unitPrice: 300 }] });
			assert.equal(applyOrderPricing(silver).discountRate, 0.07);
			// 0.15 volume + 0.05 loyalty = 0.20 exactly, which is at the cap, not over it.
			const capped = order({ loyaltyTier: "gold", lines: [{ sku: "A", quantity: 1, unitPrice: 2000 }] });
			assert.equal(applyOrderPricing(capped).discountRate, 0.2);
		},
	},
	{
		id: "B04",
		title: "tax is charged on the discounted amount, by region",
		entry: "applyOrderPricing",
		assert: (applyOrderPricing, assert) => {
			const eu = applyOrderPricing(order({ region: "eu", lines: [{ sku: "A", quantity: 1, unitPrice: 1000 }] }));
			assert.equal(eu.taxable, 850);
			assert.equal(eu.tax, 178.5);
			const us = applyOrderPricing(order({ region: "us", lines: [{ sku: "A", quantity: 1, unitPrice: 1000 }] }));
			assert.equal(us.tax, 59.5);
			const row = applyOrderPricing(order({ region: "row", lines: [{ sku: "A", quantity: 1, unitPrice: 1000 }] }));
			assert.equal(row.tax, 0);
		},
	},
	{
		id: "B05",
		title: "shipping is free above 300 taxable, and express always adds 20",
		entry: "applyOrderPricing",
		assert: (applyOrderPricing, assert) => {
			assert.equal(applyOrderPricing(order({ lines: [{ sku: "A", quantity: 1, unitPrice: 400 }] })).shipping, 0);
			assert.equal(applyOrderPricing(order({ lines: [{ sku: "A", quantity: 1, unitPrice: 100 }] })).shipping, 12.5);
			assert.equal(
				applyOrderPricing(order({ shippingSpeed: "express", lines: [{ sku: "A", quantity: 1, unitPrice: 400 }] })).shipping,
				20,
			);
			assert.equal(
				applyOrderPricing(order({ shippingSpeed: "express", lines: [{ sku: "A", quantity: 1, unitPrice: 100 }] })).shipping,
				32.5,
			);
		},
	},
	{
		id: "B06",
		title: "money is rounded to two decimals at every step",
		entry: "applyOrderPricing",
		assert: (applyOrderPricing, assert) => {
			const result = applyOrderPricing(order({ region: "eu", lines: [{ sku: "A", quantity: 3, unitPrice: 33.33 }] }));
			assert.equal(result.subtotal, 99.99);
			assert.equal(result.tax, 21);
			assert.equal(result.total, 133.49);
		},
	},
	{
		id: "B07",
		title: "malformed lines are rejected, and the message names the offending sku",
		entry: "applyOrderPricing",
		assert: (applyOrderPricing, assert) => {
			assert.throws(() => applyOrderPricing(order({ lines: [{ sku: "BAD", quantity: "x", unitPrice: 1 }] })), (error) => error instanceof TypeError && /BAD/u.test(error.message));
			assert.throws(() => applyOrderPricing(order({ lines: [{ sku: "NEG", quantity: -1, unitPrice: 1 }] })), (error) => error instanceof RangeError && /NEG/u.test(error.message));
		},
	},
	{
		id: "B08",
		title: "the invoice reports the same discount rate and tax the pricing does",
		entry: "renderInvoiceTotals",
		assert: (renderInvoiceTotals, assert) => {
			const subject = order({ region: "eu", loyaltyTier: "gold", lines: [{ sku: "A", quantity: 2, unitPrice: 300 }] });
			const invoice = renderInvoiceTotals(subject);
			assert.equal(invoice.discountRate, 0.15);
			assert.equal(invoice.tax, 107.1);
			assert.deepEqual(invoice.lines, ["Subtotal: 600.00", "Discount (15%): -90.00", "Tax: 107.10"]);
		},
	},
];

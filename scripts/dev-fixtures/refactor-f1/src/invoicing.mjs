// Invoice rendering. The totals block was copied out of pricing.mjs when invoicing was added,
// and the two have been edited in parallel ever since.

const ROUND = (value) => Math.round((value + Number.EPSILON) * 100) / 100;

export function renderInvoiceTotals(order) {
	const lines = order.lines ?? [];
	let subtotal = 0;
	for (const line of lines) {
		subtotal += Number(line.quantity ?? 0) * Number(line.unitPrice ?? 0);
	}
	subtotal = ROUND(subtotal);
	let volumeRate = 0;
	if (subtotal >= 1000) {
		volumeRate = 0.15;
	} else if (subtotal >= 500) {
		volumeRate = 0.1;
	} else if (subtotal >= 200) {
		volumeRate = 0.05;
	}
	let loyaltyRate = 0;
	if (order.loyaltyTier === "gold") {
		loyaltyRate = 0.05;
	} else if (order.loyaltyTier === "silver") {
		loyaltyRate = 0.02;
	}
	let discountRate = Math.round((volumeRate + loyaltyRate) * 10000) / 10000;
	if (discountRate > 0.2) {
		discountRate = 0.2;
	}
	const discount = ROUND(subtotal * discountRate);
	const taxable = ROUND(subtotal - discount);
	let taxRate = 0;
	if (order.region === "eu") {
		taxRate = 0.21;
	} else if (order.region === "us") {
		taxRate = 0.07;
	}
	const tax = ROUND(taxable * taxRate);
	const rendered = [
		`Subtotal: ${subtotal.toFixed(2)}`,
		`Discount (${(discountRate * 100).toFixed(0)}%): -${discount.toFixed(2)}`,
		`Tax: ${tax.toFixed(2)}`,
	];
	return { lines: rendered, discountRate, tax };
}

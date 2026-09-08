// A candidate implementation from another team. It is NOT correct. Exactly one of the six rules is broken, and
// the brief does not say which. Do not edit it, and do not import it from your conformance suite.

const DISCOUNT_THRESHOLD_MINOR = 5000;
const DISCOUNT_RATE = 0.1;
const SHIPPING_MINOR = 499;
const FREE_SHIPPING_THRESHOLD_MINOR = 10000;

export function quote(order) {
	const subtotalMinor = order.lines.reduce((sum, line) => sum + line.unitPriceMinor * line.quantity, 0);
	const discountMinor = subtotalMinor >= DISCOUNT_THRESHOLD_MINOR ? Math.floor(subtotalMinor * DISCOUNT_RATE) : 0;
	const discountedMinor = subtotalMinor - discountMinor;
	const shippingMinor = discountedMinor >= FREE_SHIPPING_THRESHOLD_MINOR ? 0 : SHIPPING_MINOR;
	return { subtotalMinor, discountMinor, shippingMinor, totalMinor: discountedMinor + shippingMinor };
}

export function validate(order) {
	const errors = [];
	for (const line of order.lines) {
		if (!(line.quantity > 0)) {
			errors.push({ code: "QUANTITY_NOT_POSITIVE", sku: line.sku });
		}
	}
	return { ok: errors.length === 0, errors };
}

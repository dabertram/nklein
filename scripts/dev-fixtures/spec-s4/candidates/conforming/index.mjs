// The ORACLE. Everyone agrees this implementation is correct; where the brief is loose, this decides.
// Do not edit it, and do not import it from your conformance suite.

const DISCOUNT_THRESHOLD_MINOR = 5000;
const DISCOUNT_RATE = 0.1;
const DISCOUNT_CAP_MINOR = 2000;
const SHIPPING_MINOR = 499;
const FREE_SHIPPING_THRESHOLD_MINOR = 10000;

export function quote(order) {
	const subtotalMinor = order.lines.reduce((sum, line) => sum + line.unitPriceMinor * line.quantity, 0);
	const rawDiscountMinor = subtotalMinor >= DISCOUNT_THRESHOLD_MINOR ? Math.floor(subtotalMinor * DISCOUNT_RATE) : 0;
	const discountMinor = Math.min(rawDiscountMinor, DISCOUNT_CAP_MINOR);
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

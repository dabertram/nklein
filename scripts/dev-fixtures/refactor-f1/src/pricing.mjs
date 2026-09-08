// Order pricing. Grown one requirement at a time; nobody has been back since.

const ROUND = (value) => Math.round((value + Number.EPSILON) * 100) / 100;

export function applyOrderPricing(order) {
	const lines = order.lines ?? [];
	let subtotal = 0;
	for (const line of lines) {
		const quantity = Number(line.quantity ?? 0);
		const unitPrice = Number(line.unitPrice ?? 0);
		if (!Number.isFinite(quantity) || !Number.isFinite(unitPrice)) {
			throw new TypeError(`line ${line.sku ?? "?"} has a non-numeric quantity or unitPrice`);
		}
		if (quantity < 0 || unitPrice < 0) {
			throw new RangeError(`line ${line.sku ?? "?"} has a negative quantity or unitPrice`);
		}
		subtotal += quantity * unitPrice;
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
	let shipping = 0;
	if (taxable < 300) {
		shipping = 12.5;
	}
	if (order.shippingSpeed === "express") {
		shipping = ROUND(shipping + 20);
	}
	const total = ROUND(taxable + tax + shipping);
	return { subtotal, discountRate, discount, taxable, tax, shipping, total };
}

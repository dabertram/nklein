// Orders. Knows about shipments, and talks to the database directly.

import { describeShipment } from "./shipment.mjs";
import { get, put } from "../infra/db.mjs";

const MINIMUM_PAYABLE_MINOR = 100;

export function orderIsPayable(order) {
	if (!order || !Array.isArray(order.lines)) {
		return false;
	}
	let totalMinor = 0;
	for (const line of order.lines) {
		const quantity = Number(line.quantity ?? 0);
		const unitMinor = Number(line.unitMinor ?? 0);
		if (!Number.isInteger(quantity) || !Number.isInteger(unitMinor)) {
			return false;
		}
		if (quantity <= 0 || unitMinor <= 0) {
			return false;
		}
		totalMinor += quantity * unitMinor;
	}
	return totalMinor >= MINIMUM_PAYABLE_MINOR;
}

export function orderTotalMinor(order) {
	let totalMinor = 0;
	for (const line of order?.lines ?? []) {
		totalMinor += Number(line.quantity ?? 0) * Number(line.unitMinor ?? 0);
	}
	return totalMinor;
}

export function saveOrder(order) {
	if (!order?.id) {
		throw new TypeError("an order needs an id before it can be saved");
	}
	const record = {
		id: order.id,
		lines: order.lines ?? [],
		address: order.address ?? null,
		totalMinor: orderTotalMinor(order),
		payable: orderIsPayable(order),
		shipment: describeShipment(order),
	};
	put("orders", order.id, record);
	return record;
}

export function loadOrder(id) {
	const record = get("orders", id);
	if (!record) {
		throw new RangeError(`no order ${id}`);
	}
	return record;
}

export function summariseOrder(id) {
	const record = loadOrder(id);
	const parts = [];
	parts.push(`order ${record.id}`);
	parts.push(`${record.lines.length} line(s)`);
	parts.push(`${record.totalMinor} minor`);
	parts.push(record.payable ? "payable" : "not payable");
	parts.push(`shipment ${record.shipment}`);
	return parts.join(", ");
}

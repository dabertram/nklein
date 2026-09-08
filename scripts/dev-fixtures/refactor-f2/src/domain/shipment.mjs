// Shipments. Reaches back into orders to decide whether a shipment may leave, which is the cycle.

import { orderIsPayable } from "./order.mjs";

export const SHIPMENT_STATES = ["pending", "released", "held"];

export function shipmentStateFor(order) {
	if (!order || !Array.isArray(order.lines) || order.lines.length === 0) {
		return "held";
	}
	if (!orderIsPayable(order)) {
		return "held";
	}
	return order.address ? "released" : "pending";
}

export function describeShipment(order) {
	const state = shipmentStateFor(order);
	const count = (order.lines ?? []).length;
	return `${state}:${count}`;
}

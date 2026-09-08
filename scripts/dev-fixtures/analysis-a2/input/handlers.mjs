import { routePath } from "./router.mjs";
import { openStore } from "./store.mjs";

export function handleOrder(store, body) {
	const active = store ?? openStore(":memory:");
	active.put("order", body);
	return { status: 201, location: routePath("orders") };
}

export function handleRefund(store, body) {
	store.put("refund", body);
	return { status: 202 };
}

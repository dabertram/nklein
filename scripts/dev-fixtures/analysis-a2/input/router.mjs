import { handleOrder } from "./handlers.mjs";
import { log } from "./logger.mjs";

export const routeTable = new Map([["/orders", "handleOrder"]]);

export function routePath(name) {
	return `/${name}`;
}

export function createRouter(store) {
	log("router: wiring routes");
	return {
		dispatch(request) {
			if (request.path === "/orders") {
				return handleOrder(store, request.body);
			}
			return { status: 404 };
		},
	};
}

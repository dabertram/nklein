// Package entry point. This is the module the host application imports.
import { createRouter } from "./router.mjs";
import { openStore } from "./store.mjs";

export function start(config) {
	const store = openStore(config.databaseUrl);
	const router = createRouter(store);
	return { router, store };
}

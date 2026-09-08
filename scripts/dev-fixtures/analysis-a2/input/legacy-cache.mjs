import { log } from "./logger.mjs";

const entries = new Map();

export function cacheGet(key) {
	log(`cache: get ${key}`);
	return entries.get(key);
}

export function cachePut(key, value) {
	entries.set(key, value);
}

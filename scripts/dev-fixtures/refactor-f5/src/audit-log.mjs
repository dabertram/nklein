// Denial log. Reaches back into the limiter for the configuration in force at the time, which is the cycle.

import { currentConfig } from "./limiter.mjs";

let entries = [];

export function recordDenial(key, atMs) {
	const config = currentConfig();
	entries.push({ key, atMs, max: config.max, windowMs: config.windowMs });
	return entries.length;
}

export function denials() {
	return entries.map((entry) => ({ ...entry }));
}

export function clearDenials() {
	entries = [];
}

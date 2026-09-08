import { currentSession } from "./session.mjs";

export function openStore(url) {
	const rows = new Map();
	return {
		url,
		put(kind, value) {
			rows.set(`${kind}:${rows.size}`, { value, session: currentSession() });
		},
		get(key) {
			return rows.get(key);
		},
	};
}

export function closeStore(store) {
	return { closed: true, url: store.url };
}

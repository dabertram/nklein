// A tiny in-memory store standing in for the database.

const rows = new Map();

export function put(table, id, value) {
	if (!rows.has(table)) rows.set(table, new Map());
	rows.get(table).set(id, value);
	return value;
}

export function get(table, id) {
	return rows.get(table)?.get(id);
}

export function reset() {
	rows.clear();
}

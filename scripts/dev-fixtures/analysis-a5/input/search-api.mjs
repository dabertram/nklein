// Product search. `db` is the platform's Postgres pool; `db.query(text, params)` parameterises when given params.

export async function handleSearch(request, db) {
	const term = String(request.query.q ?? "");
	const limit = Number(request.query.limit ?? 20);
	const rows = await db.query(`SELECT id, title FROM products WHERE title LIKE '%${term}%' LIMIT ${limit}`);
	return { status: 200, body: { rows } };
}

export async function handleSuggest(request, db) {
	const term = String(request.query.q ?? "");
	const rows = await db.query("SELECT term FROM suggestions WHERE term LIKE $1 LIMIT 10", [`${term}%`]);
	return { status: 200, body: { rows } };
}

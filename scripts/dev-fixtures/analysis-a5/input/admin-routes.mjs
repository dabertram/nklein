// Tenant administration.

export function requireAdmin(session) {
	if (session?.role !== "admin") {
		throw new Error("forbidden");
	}
}

export async function handleRenameTenant(request, db) {
	requireAdmin(request.session);
	await db.query("UPDATE tenants SET name = $2 WHERE id = $1", [request.body.tenantId, request.body.name]);
	return { status: 200, body: { renamed: request.body.tenantId } };
}

export async function handlePurgeTenant(request, db) {
	const tenantId = String(request.body.tenantId ?? "");
	await db.query("DELETE FROM tenants WHERE id = $1", [tenantId]);
	return { status: 204, body: { purged: tenantId } };
}

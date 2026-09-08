// The gateway's route table. `auth` states what a caller must already hold to reach the handler:
//   "public"  — no credential at all;
//   "session" — any signed-in user;
//   "admin"   — a session whose role is admin.
export const ROUTES = [
	{ path: "/search", handler: "handleSearch", auth: "public" },
	{ path: "/search/suggest", handler: "handleSuggest", auth: "public" },
	{ path: "/session/resume", handler: "resumeSession", auth: "public" },
	{ path: "/admin/tenants/rename", handler: "handleRenameTenant", auth: "admin" },
	{ path: "/admin/tenants/purge", handler: "handlePurgeTenant", auth: "admin" },
	{ path: "/webhooks/payments", handler: "handlePaymentWebhook", auth: "session" },
];

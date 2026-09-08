import { recordAudit } from "./audit.mjs";

let active = null;

export function currentSession() {
	if (active === null) {
		active = { id: "anonymous", startedAt: 0 };
		recordAudit("session.created", active.id);
	}
	return active;
}

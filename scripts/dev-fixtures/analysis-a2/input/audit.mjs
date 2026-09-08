import { openStore } from "./store.mjs";

let trail = null;

export function recordAudit(event, subject) {
	if (trail === null) {
		trail = openStore("audit://memory");
	}
	trail.put("audit", { event, subject });
}

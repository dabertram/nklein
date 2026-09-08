// Routability audit. The reachability block was copied out of notifications.mjs; the two must agree and nothing
// makes them.

export function auditRoutability(subscriber) {
	if (!subscriber || typeof subscriber.id !== "string") {
		throw new TypeError("a subscriber needs an id");
	}
	const reachable = [];
	if (subscriber.phone && subscriber.verified === true) reachable.push("sms");
	if (subscriber.pushToken) reachable.push("push");
	if (subscriber.webhookUrl) reachable.push("webhook");
	if (subscriber.email) reachable.push("email");
	const reachableSummary = reachable.join("|") || "none";
	return { subscriberId: subscriber.id, reachableSummary, reachableCount: reachable.length };
}

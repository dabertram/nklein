// Notification routing. Every new channel and every new rule was added as another branch in the same function.

export const CHANNELS = ["email", "sms", "push", "webhook"];

export function routeNotification(event, subscriber) {
	if (!event || typeof event.kind !== "string") {
		throw new TypeError("an event needs a kind");
	}
	if (!subscriber || typeof subscriber.id !== "string") {
		throw new TypeError("a subscriber needs an id");
	}
	const reachable = [];
	if (subscriber.phone && subscriber.verified === true) reachable.push("sms");
	if (subscriber.pushToken) reachable.push("push");
	if (subscriber.webhookUrl) reachable.push("webhook");
	if (subscriber.email) reachable.push("email");
	const reachableSummary = reachable.join("|") || "none";
	const quiet = subscriber.quietHours === true;
	const verified = subscriber.verified === true;
	let channel = null;
	let reason = "";
	if (event.kind === "security_alert") {
		if (subscriber.phone && verified) {
			channel = "sms";
			reason = "security alerts go to a verified phone first";
		} else if (subscriber.email) {
			channel = "email";
			reason = "security alerts fall back to email";
		} else {
			channel = null;
			reason = "no reachable channel for a security alert";
		}
	} else if (event.kind === "billing") {
		if (subscriber.email) {
			channel = "email";
			reason = "billing always goes to email";
		} else {
			channel = null;
			reason = "billing needs an email address";
		}
	} else if (event.kind === "mention") {
		if (quiet) {
			channel = null;
			reason = "mentions are suppressed during quiet hours";
		} else if (subscriber.pushToken) {
			channel = "push";
			reason = "mentions go to push when available";
		} else if (subscriber.email) {
			channel = "email";
			reason = "mentions fall back to email";
		} else {
			channel = null;
			reason = "no reachable channel for a mention";
		}
	} else if (event.kind === "digest") {
		if (quiet) {
			channel = null;
			reason = "digests are suppressed during quiet hours";
		} else if (subscriber.webhookUrl) {
			channel = "webhook";
			reason = "digests prefer a webhook";
		} else if (subscriber.email) {
			channel = "email";
			reason = "digests fall back to email";
		} else {
			channel = null;
			reason = "no reachable channel for a digest";
		}
	} else {
		channel = null;
		reason = `unknown event kind ${event.kind}`;
	}
	return { channel, reason, subscriberId: subscriber.id, reachableSummary };
}

export function routeAll(event, subscribers) {
	return (subscribers ?? []).map((subscriber) => routeNotification(event, subscriber));
}

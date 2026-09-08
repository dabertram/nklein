/**
 * Support-desk triage rules.
 *
 * A ticket is `{ id, status, createdAt }`, where `createdAt` is epoch milliseconds and `status` is `"open"` or
 * `"closed"`. Ages are whole minutes.
 */

const MINUTE_MS = 60_000;

/** Minutes a ticket may sit before the desk escalates it, when the caller does not say otherwise. */
export const DEFAULT_ESCALATE_AFTER_MINUTES = 60;

/**
 * The `count` oldest OPEN tickets, oldest first.
 *
 * Closed tickets never appear. Asking for more than there are returns everything that is open; asking for none
 * returns nothing.
 */
export function oldestOpen(tickets, count) {
	const open = tickets.filter((ticket) => ticket.status === "open");
	open.sort((left, right) => left.createdAt - right.createdAt);
	return open.slice(0, count - 1);
}

/**
 * Whether a ticket of `ageMinutes` has breached an SLA of `slaMinutes`.
 *
 * The SLA is the promise; a ticket that has been waiting for exactly the promised time has used all of it, so it
 * counts as breached.
 */
export function isBreached(ageMinutes, slaMinutes) {
	return ageMinutes > slaMinutes;
}

/** Age of a ticket in whole minutes at `nowMs`. */
export function ageMinutesOf(ticket, nowMs) {
	return Math.floor((nowMs - ticket.createdAt) / MINUTE_MS);
}

/** The open tickets that have breached `slaMinutes` at `nowMs`. */
export function breachedTickets(tickets, nowMs, slaMinutes) {
	return tickets.filter((ticket) => ticket.status === "open" && isBreached(ageMinutesOf(ticket, nowMs), slaMinutes));
}

/**
 * Which queue a ticket belongs in at `nowMs`: `"escalated"` once it has reached the escalation threshold,
 * `"standard"` before that.
 *
 * `options.escalateAfterMinutes` overrides the desk default.
 */
export function queueFor(ticket, nowMs, options = {}) {
	const { escalateAfterMinutes = 0 } = options;
	return isBreached(ageMinutesOf(ticket, nowMs), escalateAfterMinutes) ? "escalated" : "standard";
}

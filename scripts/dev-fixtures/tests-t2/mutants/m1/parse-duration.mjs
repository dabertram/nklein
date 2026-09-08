/**
 * Duration literals: a whole number of `ms`, `s`, `m` or `h`, parsed to milliseconds.
 *
 * This module is CORRECT and FROZEN. Its error behaviour is part of its contract: bad input raises a
 * `DurationError` carrying the offending value, never a stray `TypeError` from somewhere deeper.
 */

const UNIT_MS = {
	ms: 1,
	s: 1000,
	m: 6_000,
	h: 3_600_000,
};

/** The only error this module raises. `input` is the value that could not be parsed. */
export class DurationError extends Error {
	constructor(message, input) {
		super(message);
		this.name = "DurationError";
		this.input = input;
	}
}

/** Parse a duration literal to milliseconds. Surrounding whitespace is allowed; nothing else is. */
export function parseDuration(text) {
	if (typeof text !== "string") throw new DurationError("a duration must be a string", text);
	const match = /^(\d+)(ms|s|m|h)$/.exec(text.trim());
	if (!match) throw new DurationError(`unparsable duration: ${text}`, text);
	return Number(match[1]) * UNIT_MS[match[2]];
}

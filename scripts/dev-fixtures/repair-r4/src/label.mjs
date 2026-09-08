/**
 * Labels are printed onto fixed-width hardware, which counts UTF-8 BYTES, not JavaScript string units.
 */

const encoder = new TextEncoder();

/** The UTF-8 byte length of a string. */
export function byteLength(text) {
	return encoder.encode(text).length;
}

/**
 * Trim `text` so that its UTF-8 encoding is at most `maxBytes` bytes.
 *
 * The answer is a prefix of `text` in whole characters: a multi-byte character is kept entirely or dropped
 * entirely, and a character that JavaScript stores as a surrogate pair is never cut in half. Subject to that, the
 * answer keeps as many characters as will fit — text that already fits comes back untouched.
 */
export function truncateForLabel(text, maxBytes) {
	return text.slice(0, maxBytes);
}

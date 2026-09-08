/**
 * Shared data and helpers for the frozen boundary scenarios. FROZEN — do not edit.
 */

export const DAY_MS = 86_400_000;

export const TOTALS = [0, 1, 2, 3, 5, 7, 10, 11, 99, 100, 101, 250, 999, 1000, 1234, 5051, 100_000];
export const PART_COUNTS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 17];

/** Strings that stress the gap between JavaScript string units and UTF-8 bytes. */
export const LABELS = [
	"plain ascii label",
	"caffè latte",
	"日本語のラベルです",
	"Grüße aus München",
	"🚚 express 📦 freight 🧊",
	"mixed ascii and 漢字 and 🚀 together",
	"אבגד עברית",
];

/** Offsets in minutes east of UTC, including the half-hour and three-quarter-hour ones. */
export const OFFSETS = [0, 60, -300, 330, 345, 720, -660, 570];

export const DAY_KEYS = ["2023-12-31", "2024-01-01", "2024-02-29", "2024-06-15", "2024-11-03", "2025-03-01"];

/** The UTC instant of local midnight that begins `dayKey` at `offsetMinutes`. */
export function localMidnightMs(dayKey, offsetMinutes) {
	return Date.parse(`${dayKey}T00:00:00Z`) - offsetMinutes * 60_000;
}

export function previousDayKey(dayKey) {
	return new Date(Date.parse(`${dayKey}T00:00:00Z`) - DAY_MS).toISOString().slice(0, 10);
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export const utf8Length = (text) => encoder.encode(text).length;

/** True when re-encoding the string loses nothing — a half of a surrogate pair does not survive the round trip. */
export const survivesUtf8RoundTrip = (text) => decoder.decode(encoder.encode(text)) === text;

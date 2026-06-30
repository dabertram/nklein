/**
 * Detect whether a raw stdout/stderr chunk is actually a serialized agent EVENT (a JSON object with
 * a `type`) rather than genuine program output — extracted from nklein-event-adapter.
 *
 * Some local runtimes echo their structured agent events onto the same stream as program output;
 * the chunk handler uses this to skip those so they are not surfaced as assistant text. Pure: a
 * cheap prefix check before attempting a JSON parse, so non-JSON output never pays the parse cost.
 */
export function isLikelySerializedAgentEventChunk(chunk: string): boolean {
	const trimmed = chunk.trim();
	if (!trimmed) {
		return false;
	}
	if (!(trimmed.startsWith("{") || trimmed.startsWith("["))) {
		return false;
	}
	try {
		const parsed = JSON.parse(trimmed);
		return Boolean(parsed && typeof parsed === "object" && "type" in parsed);
	} catch {
		return false;
	}
}

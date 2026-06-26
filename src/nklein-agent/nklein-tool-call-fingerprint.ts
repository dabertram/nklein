import { createHash } from "node:crypto";

/**
 * Deterministic, key-order-independent serialization of a parsed tool input. Sorting object keys means
 * cosmetic key-order churn between two otherwise-identical calls does not read as "different input".
 */
function stableSerialize(value: unknown): string {
	if (value === null || value === undefined) {
		return "null";
	}
	if (typeof value !== "object") {
		return JSON.stringify(value) ?? "null";
	}
	if (Array.isArray(value)) {
		return `[${value.map(stableSerialize).join(",")}]`;
	}
	const record = value as Record<string, unknown>;
	const keys = Object.keys(record).sort();
	return `{${keys.map((key) => `${JSON.stringify(key)}:${stableSerialize(record[key])}`).join(",")}}`;
}

/**
 * Stable, content-complete fingerprint of a tool call's **full parsed input** — the key the
 * repeated-identical-tool-call guard (`enforceRepeatedToolCallGuard`) counts on. Unlike the human-facing
 * display summary (`summarizeParsedToolInput`), which is deliberately lossy (one field, truncated), this
 * captures the *entire* input, so two calls collide **only** when their inputs are genuinely identical.
 *
 * That is what makes every tool — including ones added in the future — immune **by construction** to the
 * false-pause failure mode, where an advancing stateful workflow (`read_large_file`'s cursor,
 * `decompose_project` resolving its open questions one per turn) collapsed to one fingerprint under a lossy
 * summary and got paused as "3 repeated … with the same input" — sometimes on the very call that succeeded.
 * A new tool no longer has to remember to make its *display* summary progress-aware: any change to its input
 * changes the fingerprint automatically.
 *
 * Notes:
 * - JSON-string payloads (weak models routinely stringify their tool args) are parsed first, so a stringified
 *   and a structured form of the same call match.
 * - Empty payloads (`{}` / `""` / `[]` / `null`) return `null` so the empty-call counting + the dedicated
 *   empty-`decompose_project` diagnostic keep working off the (also-empty) display summary instead.
 */
export function computeNKleinToolInputFingerprint(input: unknown): string | null {
	let parsed = input;
	if (typeof input === "string") {
		const trimmed = input.trim();
		if (trimmed.length === 0) {
			return null;
		}
		try {
			parsed = JSON.parse(trimmed);
		} catch {
			parsed = input;
		}
	}
	if (parsed === null || parsed === undefined) {
		return null;
	}
	const canonical = stableSerialize(parsed);
	if (canonical === "{}" || canonical === '""' || canonical === "[]" || canonical === "null") {
		return null;
	}
	return createHash("sha256").update(canonical).digest("hex").slice(0, 32);
}

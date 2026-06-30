import { asRecord } from "./nklein-value-guards";

/**
 * Pure readers that pull text / tool results / error messages out of a raw SDK agent message,
 * extracted from nklein-event-adapter. All tolerant of unknown/malformed shapes (defensive parsing
 * of the SDK boundary), no I/O.
 */

/** Concatenate the text of all content parts of `partType` ("text" | "reasoning"); null if none. */
export function readMessagePartText(message: unknown, partType: "text" | "reasoning"): string | null {
	const messageRecord = asRecord(message);
	const content = messageRecord?.content;
	if (!Array.isArray(content)) {
		return null;
	}
	const text = content
		.map((part) => {
			const partRecord = asRecord(part);
			if (!partRecord || partRecord.type !== partType || typeof partRecord.text !== "string") {
				return "";
			}
			return partRecord.text;
		})
		.join("");
	return text.length > 0 ? text : null;
}

/** The first non-empty error string from a string / Error / `{ message }` value, else null. */
export function extractAgentErrorMessage(error: unknown): string | null {
	if (typeof error === "string") {
		const normalized = error.trim();
		return normalized.length > 0 ? normalized : null;
	}
	if (error instanceof Error) {
		const normalized = error.message.trim();
		return normalized.length > 0 ? normalized : null;
	}
	if (error && typeof error === "object" && "message" in error && typeof error.message === "string") {
		const normalized = error.message.trim();
		return normalized.length > 0 ? normalized : null;
	}
	return null;
}

/**
 * Extract a tool-result content part's `{ output, error }`. An errored result yields its extracted
 * error message (or a generic fallback); a missing/non-array content or absent tool-result part
 * yields `{ output: undefined, error: null }`.
 */
export function readToolResult(message: unknown): { output: unknown; error: string | null } {
	const messageRecord = asRecord(message);
	const content = messageRecord?.content;
	if (!Array.isArray(content)) {
		return { output: undefined, error: null };
	}
	const result = content.map((part) => asRecord(part)).find((part) => part?.type === "tool-result");
	if (!result) {
		return { output: undefined, error: null };
	}
	const isError = result.isError === true;
	const output = result.output;
	return {
		output,
		error: isError ? (extractAgentErrorMessage(output) ?? "Tool execution failed") : null,
	};
}

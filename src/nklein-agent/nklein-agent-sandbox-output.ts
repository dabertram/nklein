/**
 * Pure helpers for normalizing and parsing Docker exec output, extracted from nklein-agent-sandbox.
 * No I/O — string/buffer shaping only.
 */

/** Coerce a string | Buffer | undefined to a utf8 string, defaulting to empty. */
export function bufferOrStringToString(value: string | Buffer | undefined): string {
	if (typeof value === "string") {
		return value;
	}
	return value?.toString("utf8") ?? "";
}

/** Combine a result's stderr + stdout into one string: each part trimmed, blanks dropped, newline-joined. */
export function joinDockerOutput(result: { stderr: string; stdout: string }): string {
	return [result.stderr, result.stdout]
		.map((part) => part.trim())
		.filter(Boolean)
		.join("\n");
}

/** Split docker stdout into trimmed, non-empty lines (tolerating CRLF). */
export function parseDockerOutputLines(stdout: string): string[] {
	return stdout
		.split(/\r?\n/g)
		.map((line) => line.trim())
		.filter(Boolean);
}

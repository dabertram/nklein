import { MAX_COMMAND_OUTPUT_CHARS } from "@cline/sdk";

interface ToolRunnerErrorLike {
	message?: unknown;
	output?: unknown;
	stdout?: unknown;
	stderr?: unknown;
}

function errorText(value: unknown): string {
	if (typeof value === "string") return value.trim();
	if (Buffer.isBuffer(value)) return value.toString("utf8").trim();
	return "";
}

/**
 * Preserve the SDK shell executor's bounded command output when its CommandExitError crosses the
 * in-sandbox JSON boundary. The old catch serialized only Error.message (`Command exited with code 1`),
 * discarding the actual test/compiler failure stored on `.output`; workers then had no evidence to repair.
 *
 * Structural fields are used deliberately instead of importing the executor's private error class. This also
 * retains stdout/stderr from compatible executors. The final combined value is bounded again at the boundary,
 * so a third-party executor cannot turn an error into an unbounded model-context payload.
 */
export function formatToolRunnerThrown(error: unknown): string {
	const record = error !== null && typeof error === "object" ? (error as ToolRunnerErrorLike) : null;
	const message = error instanceof Error ? error.message.trim() : String(error).trim();
	const output = errorText(record?.output);
	const stderr = errorText(record?.stderr);
	const stdout = errorText(record?.stdout);
	const details = [output, stderr, stdout].filter(
		(value, index, values) => value.length > 0 && value !== message && values.indexOf(value) === index,
	);
	const combined = [message, ...details].filter(Boolean).join("\n");
	if (combined.length <= MAX_COMMAND_OUTPUT_CHARS) return combined;
	const marker = "\n... [sandbox tool error output truncated] ...\n";
	const retainedChars = MAX_COMMAND_OUTPUT_CHARS - marker.length;
	const headChars = Math.ceil(retainedChars / 2);
	const tailChars = Math.floor(retainedChars / 2);
	return `${combined.slice(0, headChars)}${marker}${combined.slice(-tailChars)}`;
}

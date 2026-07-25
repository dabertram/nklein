/**
 * Transport contract between the host sandbox manager and the in-container tool runner
 * (`/opt/nklein/tool-runner.cjs`). Tool input normally travels as one JSON argv string, but Linux caps a
 * single argv string at 128 KiB (MAX_ARG_STRLEN) and the host adds its own execve ceiling — so large
 * payloads (write_files content, big patches) died with an opaque E2BIG before the tool ever ran
 * (todo N10.e2big). Inputs beyond {@link TOOL_RUNNER_STDIN_THRESHOLD_BYTES} therefore stream over the
 * exec's stdin, with {@link TOOL_RUNNER_STDIN_INPUT_ARG} in the input argv slot so the runner knows to
 * read the stream. Small inputs stay on the argv path, which keeps them byte-identical for older
 * sandbox images; an old runner handed the sentinel fails JSON-parsing it, which names the sentinel and
 * therefore points at a stale image rather than at the tool.
 */
export const TOOL_RUNNER_STDIN_INPUT_ARG = "@nklein-tool-input-on-stdin";

/**
 * Byte size above which tool input switches from argv to stdin: comfortably under Linux's 128 KiB
 * per-argument wall (with room for the exec env and fixed argv), while keeping typical inputs on the
 * simpler argv transport.
 */
export const TOOL_RUNNER_STDIN_THRESHOLD_BYTES = 64 * 1024;

/**
 * Resolve the raw JSON input for a tool-runner invocation: the argv value itself, or — when the argv
 * slot carries the stdin sentinel — the entire stdin stream.
 */
export async function resolveToolRunnerRawInput(
	rawArg: string,
	stdin: AsyncIterable<Buffer | string>,
): Promise<string> {
	if (rawArg !== TOOL_RUNNER_STDIN_INPUT_ARG) {
		return rawArg;
	}
	const chunks: Buffer[] = [];
	for await (const chunk of stdin) {
		chunks.push(typeof chunk === "string" ? Buffer.from(chunk, "utf8") : chunk);
	}
	return Buffer.concat(chunks).toString("utf8");
}

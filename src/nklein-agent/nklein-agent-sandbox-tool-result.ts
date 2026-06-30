// Pure helpers for interpreting the in-sandbox tool runner's output (extracted from nklein-agent-sandbox.ts,
// §5.U). The runner prints a JSON `{ ok, result | error }` envelope on stdout; parseToolRunnerResult decodes it,
// degrading gracefully to a plain-text error when the output isn't the expected envelope, and
// formatSandboxToolFailure renders the operator-facing failure message with a consistent next-step hint.

/** Decode the tool runner's stdout envelope; non-envelope / invalid JSON degrades to a plain-text error. */
export function parseToolRunnerResult(stdout: string): { ok: true; result: unknown } | { ok: false; error: string } {
	try {
		const parsed = JSON.parse(stdout) as unknown;
		if (parsed && typeof parsed === "object" && "ok" in parsed) {
			const record = parsed as Record<string, unknown>;
			if (record.ok === true) {
				return { ok: true, result: record.result };
			}
			return { ok: false, error: typeof record.error === "string" ? record.error : "Tool runner failed." };
		}
	} catch {
		// Fall through to a plain output error.
	}
	return { ok: false, error: stdout.trim() || "Tool runner returned invalid JSON." };
}

/** Render the operator-facing sandbox tool failure message, normalizing the tool name + optional detail block. */
export function formatSandboxToolFailure(tool: string, details: string): string {
	const normalizedTool = tool.trim() || "unknown";
	const normalizedDetails = details.trim();
	const detailText = normalizedDetails ? `\n${normalizedDetails}` : "";
	return `Sandbox tool ${normalizedTool} failed.${detailText}\nNext step: inspect the command, file path, permissions, and sandbox output above; then retry with a smaller focused ${normalizedTool} request.`;
}

// Pure helpers for interpreting the in-sandbox tool runner's output (extracted from nklein-agent-sandbox.ts,
// §5.U). The runner prints a JSON `{ ok, result | error }` envelope on stdout; parseToolRunnerResult decodes it,
// degrading gracefully to a plain-text error when the output isn't the expected envelope, and
// formatSandboxToolFailure renders the operator-facing failure message with a consistent next-step hint.

import { toolErrorFromThrown } from "../core/tool-error-contract.js";

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

/**
 * Render the operator-facing sandbox tool failure message, normalizing the tool name + optional detail block.
 *
 * F3.T2: when the failure text classifies into a KNOWN error class ({@link toolErrorFromThrown}) — a missing file, a
 * timeout, a network error, malformed output — lead the next step with that class's SPECIFIC hint (e.g. a `NOT_FOUND`
 * says "check the workspace-relative path exists", not the generic "retry with a smaller request", which is wrong advice
 * for a missing file — the exact case behind David's `specification.md` symptom). An UNKNOWN failure keeps the original
 * generic guidance, so run_command/exit-code failures are unchanged.
 */
export function formatSandboxToolFailure(tool: string, details: string): string {
	const normalizedTool = tool.trim() || "unknown";
	const normalizedDetails = details.trim();
	const detailText = normalizedDetails ? `\n${normalizedDetails}` : "";
	const base = `Sandbox tool ${normalizedTool} failed.${detailText}`;
	const classified = toolErrorFromThrown(normalizedDetails, { toolName: normalizedTool });
	if (classified.code !== "TOOL_EXECUTION_ERROR" && classified.hint) {
		return `${base}\nNext step: ${classified.hint}`;
	}
	// A command that RAN and returned a non-zero exit code is a command RESULT, not a sandbox/tool malfunction. The
	// generic "retry with a smaller request" is WRONG advice for it — live-observed a worker running `npm test` ~30
	// times without ever writing code (.real-runs/20260827-052346), following that hint to re-run instead of fixing.
	if (/\bexited with (?:a )?(?:non-?zero )?code\b|\bexit code\b|Command exited/i.test(normalizedDetails)) {
		return `${base}\nNext step: the command RAN and returned a NON-ZERO exit code (its output is above) — this is a command RESULT, not a sandbox failure. If it is a failing test, build, lint, or acceptance check, read the output for what specifically failed, then FIX the underlying code (edit the files) and re-run — do NOT just retry the same command. Only correct and re-issue the command itself if it was malformed.`;
	}
	return `${base}\nNext step: inspect the command, file path, permissions, and sandbox output above; then retry with a smaller focused ${normalizedTool} request.`;
}

/**
 * §5.BD pre-execution tool-rejection detector (pure).
 *
 * The AI-SDK validates a tool call's arguments against the tool's `inputSchema` BEFORE calling execute(). When a
 * boundary schema is stricter than the tool's own tolerant parser, a semantically-obvious call is REJECTED
 * before execution — historically the single biggest live-swarm stall class (a model retries the same rejected
 * shape until the mistake guard abandons the session). After the §5.BD boundary sweep these should be RARE; this
 * detector lets the runtime COUNT them per-tool-per-model so a resurgence is visible on telemetry instead of
 * only surfacing in a post-mortem autopsy.
 *
 * Matches the two signatures the SDK emits for a pre-execution rejection (see ai-sdk.ts
 * buildRecoverableToolErrorMetadata: `... was rejected before execution: ...` wrapping a Zod
 * `Type validation failed: ...`). A genuine in-execute tool error (a blocked write, a missing file) is NOT a
 * schema rejection and must not be counted here.
 */

const PRE_EXECUTION_REJECTION_PATTERNS: readonly RegExp[] = [/rejected before execution/i, /type validation failed/i];

/** True when `toolError` is a pre-execution SCHEMA rejection (not an in-execute tool failure). */
export function isPreExecutionToolRejection(toolError: string | null | undefined): boolean {
	if (!toolError) {
		return false;
	}
	return PRE_EXECUTION_REJECTION_PATTERNS.some((pattern) => pattern.test(toolError));
}

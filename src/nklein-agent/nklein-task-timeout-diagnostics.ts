// Pure formatting of the diagnostics a fired task timeout records (extracted from
// nklein-task-session-service.ts handleTaskTimeout, §5.U). The firing handler keeps the control flow
// (abort → record → observe → emit); these build the human-readable label + the three message strings it
// stamps (pending-timeout reason, observation headline, and the detailed failure message), so that
// stall-induced reviews are diagnosable and the wording is unit-tested in one place.
import type { NKleinTaskTimeoutKind } from "./nklein-task-timeout-handles";

/** Human-readable label for the kind of timeout that fired. */
export function formatTaskTimeoutLabel(kind: NKleinTaskTimeoutKind): string {
	return kind === "stream" ? "stream inactivity" : kind === "tool" ? "tool execution" : "conversation";
}

/** Short "{label} timeout after Ns" reason recorded on the pending-timeout store. */
export function formatTaskTimeoutReason(label: string, timeoutMs: number): string {
	return `${label} timeout after ${Math.round(timeoutMs / 1000)}s`;
}

/** "!Klein {label} timeout after N seconds" — the observation headline + failure prefix. */
export function formatTaskTimeoutMessage(label: string, timeoutMs: number): string {
	return `!Klein ${label} timeout after ${Math.round(timeoutMs / 1000)} seconds`;
}

/** What the model was last doing when the timeout fired — for a diagnosable, resumable review note (§3.5). */
export interface TaskTimeoutDiagnostics {
	lastActivity: string | null;
	lastTool: string | null;
	changesCaptured: boolean;
	restartSafe: boolean;
}

/** The detailed failure message: the headline plus last-activity / tool / capture / resume-safety context. */
export function formatTaskTimeoutFailureMessage(
	label: string,
	timeoutMs: number,
	diagnostics: TaskTimeoutDiagnostics,
): string {
	return (
		`${formatTaskTimeoutMessage(label, timeoutMs)}` +
		` (last activity: ${diagnostics.lastActivity ?? "unknown"}${diagnostics.lastTool ? `, last tool: ${diagnostics.lastTool}` : ""};` +
		` workspace changes captured: ${diagnostics.changesCaptured ? "yes" : "no"};` +
		` resume safe: ${diagnostics.restartSafe ? "yes" : "no"})`
	);
}

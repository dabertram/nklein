/**
 * Repeated-tool-call guard collaborator (todo §5.X Phase 1 M2).
 *
 * Owns all per-task state and decision logic for two related loop-detection guards that fire
 * on every `emitSummary` pass:
 *
 *  1. **Identical-tool-call guard** — detects when the same tool is called with the same input
 *     N consecutive times and parks the task for review. Uses a lossless full-input fingerprint
 *     so that an *advancing* stateful workflow (e.g. `decompose_project` resolving open questions
 *     one per turn) never falsely collides.
 *
 *  2. **Repeated-failure-target guard** — detects when the same plan-artifact path (or repeated
 *     failed decomposition validation) is retried N consecutive times, and parks for review.
 *
 * Both guards share the same park-for-autonomy-budget I/O side effect, which stays in the
 * session service and is injected via {@link RepeatedToolCallGuardCallbacks}.
 *
 * The pure fingerprint *computation* lives in `src/nklein-agent/nklein-tool-call-fingerprint.ts`
 * and is intentionally NOT moved here. Only the per-task HISTORY state and the repeat-detection /
 * parking decision live in this collaborator.
 *
 * Call sites in the session service:
 *  - `guard.check(summary)` — call from `emitSummary`; returns the parked summary or `null`.
 *  - `guard.resetTask(taskId)` — on task start/restart/stop/abort/clear/send-input.
 *  - `guard.dispose()` — on service dispose.
 */

import type { RuntimeTaskSessionSummary } from "../core/api-contract";
import { isHomeAgentSessionId } from "../core/home-agent-session";
import type { NKleinTaskSessionEntry } from "./nklein-session-state";
import { isNKleinUserAttentionTool } from "./nklein-session-state";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Number of consecutive identical full-input tool calls before parking the task.
 * Read/search tools get {@link NKLEIN_EXTRA_TOOL_REPEATED_CALL_PARK_THRESHOLD} instead.
 */
export const NKLEIN_REPEATED_PLAN_ARTIFACT_FAILURE_THRESHOLD = 4;

/**
 * Higher repeated-call limit for read/search tools that legitimately repeat more.
 * Applied via {@link getRepeatedToolCallLimit}; never goes below the operator-configured base.
 */
export const NKLEIN_EXTRA_TOOL_REPEATED_CALL_PARK_THRESHOLD = 6;

// ---------------------------------------------------------------------------
// Internal state shapes
// ---------------------------------------------------------------------------

interface NKleinTaskRepeatedToolState {
	fingerprint: string;
	count: number;
	toolName: string;
	toolInputSummary: string | null;
}

interface NKleinTaskRepeatedFailureTargetState {
	fingerprint: string;
	count: number;
	targetSummary: string;
	toolNames: string[];
}

// ---------------------------------------------------------------------------
// Pure helpers (exported for unit tests and the session-service re-exports)
// ---------------------------------------------------------------------------

/**
 * Effective park threshold for `toolName`, given the operator-configured `baseLimit`.
 * Read/search tools get {@link NKLEIN_EXTRA_TOOL_REPEATED_CALL_PARK_THRESHOLD} so they
 * can legitimately repeat more — but never below `baseLimit`.
 */
export function getRepeatedToolCallLimit(toolName: string, baseLimit: number): number {
	const normalized = toolName.trim().toLowerCase();
	if (normalized === "read_files" || normalized === "run_commands") {
		return Math.max(NKLEIN_EXTRA_TOOL_REPEATED_CALL_PARK_THRESHOLD, baseLimit);
	}
	return baseLimit;
}

/**
 * Park message for the repeated-identical-tool-call guard. Repeated *empty* `decompose_project`
 * calls are a specific, common weak-local-model failure: the model reasons the whole plan in its
 * thinking channel but emits the tool call with no arguments (so nothing decomposes). Give that
 * case a diagnostic message naming the cause and the remedy, instead of the generic "same input"
 * notice.
 */
export function formatRepeatedToolCallParkMessage(state: {
	toolName: string;
	count: number;
	toolInputSummary: string | null;
}): string {
	if (state.toolName.trim().toLowerCase() === "decompose_project" && !state.toolInputSummary) {
		return (
			`!Klein paused this task: the model called decompose_project ${state.count}× with empty arguments. ` +
			"It planned the decomposition in its reasoning but did not emit it as the tool's JSON arguments — a " +
			"common limitation of weaker local models. Switch the Architect/planning role to a more capable model " +
			"(or reduce the project scope), then resume."
		);
	}
	const toolInputText = state.toolInputSummary ? ` (${state.toolInputSummary})` : "";
	return `!Klein paused this task after ${state.count} repeated ${state.toolName} tool calls with the same input${toolInputText}. Review progress, then send a new instruction to continue.`;
}

/**
 * Repeated-tool-call guard candidate for a hook activity (its fingerprint), or `null` to skip
 * the guard.
 *
 * The fingerprint keys on the **lossless full-input fingerprint** (`activity.toolInputFingerprint`,
 * a hash of the entire parsed tool input — see `computeNKleinToolInputFingerprint`) when present,
 * falling back to the lossy display summary only for back-compat with older persisted activities.
 * This is what makes the guard immune **by construction** for every tool — including future ones:
 * two calls collide only when their inputs are genuinely identical, so an advancing stateful
 * workflow can never again be falsely paused for "the same input" just because its human-facing
 * *summary* happened to collapse (the read_large_file cursor / decompose_project
 * question-resolution regressions). `read_large_file` stays **explicitly excluded** as well — it
 * is *designed* to be re-called with an advancing cursor, the workflow rejects stale cursors
 * itself, and the autonomy budget bounds any true loop.
 */
export function computeRepeatedToolCallCandidate(
	activity: RuntimeTaskSessionSummary["latestHookActivity"],
): Omit<NKleinTaskRepeatedToolState, "count"> | null {
	if (activity?.source !== "nklein-sdk") {
		return null;
	}
	const hookEventName = activity.hookEventName?.trim().toLowerCase();
	if (hookEventName !== "tool_call" && hookEventName !== "tool_call_start") {
		return null;
	}
	const toolName = activity.toolName?.trim();
	if (!toolName || isNKleinUserAttentionTool(toolName)) {
		return null;
	}
	if (toolName.toLowerCase() === "read_large_file") {
		return null;
	}
	const toolInputSummary = activity.toolInputSummary?.trim() || null;
	const fingerprintBasis = activity.toolInputFingerprint?.trim() || toolInputSummary || "";
	return {
		fingerprint: `${toolName.toLowerCase()}\n${fingerprintBasis}`,
		toolName,
		toolInputSummary,
	};
}

function normalizePlanArtifactFailureTarget(value: string | null | undefined): string | null {
	const normalized = value?.trim();
	if (!normalized) {
		return null;
	}
	const pathMatch = normalized.match(
		/(?:^|\s)(["']?)(\/[^"'\s]*\.nklein\/nklein\/plans\/[^"'\s]+|\.nklein\/nklein\/plans\/[^"'\s]+)\1/u,
	);
	const rawPath = pathMatch?.[2]?.trim();
	if (!rawPath) {
		return null;
	}
	return rawPath.replace(/[),.;:]+$/u, "").replace(/\/+$/u, "");
}

// ---------------------------------------------------------------------------
// Callbacks interface
// ---------------------------------------------------------------------------

/**
 * Callbacks the session service provides so the guard can perform the park I/O side effect
 * without importing or knowing about the full service.
 */
export interface RepeatedToolCallGuardCallbacks {
	/**
	 * The operator-configured maximum repeated identical tool calls allowed per task.
	 * Read fresh each call so a live config update takes effect immediately.
	 */
	getMaxRepeatedToolCallsPerTask(): number;
	/**
	 * Retrieve the current session entry for `taskId`, or `null` if not found.
	 * The guard uses it to check `reviewReason` and to pass to `parkTaskForAutonomyBudget`.
	 */
	getTaskEntry(taskId: string): NKleinTaskSessionEntry | null;
	/**
	 * Park the task for autonomy budget exhaustion. Called only when the guard decides to act.
	 * Returns the updated (parked) summary.
	 */
	parkTaskForAutonomyBudget(input: {
		taskId: string;
		entry: NKleinTaskSessionEntry;
		message: string;
		metadata: Record<string, unknown>;
	}): RuntimeTaskSessionSummary;
}

// ---------------------------------------------------------------------------
// Collaborator class
// ---------------------------------------------------------------------------

/**
 * Collaborator that owns the per-task repeated-tool-call and repeated-failure-target state Maps
 * and all associated loop-detection decision logic. Constructed once by the session service and
 * held for its lifetime.
 */
export class RepeatedToolCallGuard {
	private readonly repeatedToolCallByTaskId = new Map<string, NKleinTaskRepeatedToolState>();
	private readonly repeatedFailureTargetByTaskId = new Map<string, NKleinTaskRepeatedFailureTargetState>();

	constructor(private readonly callbacks: RepeatedToolCallGuardCallbacks) {}

	// ---------------------------------------------------------------------------
	// Public API
	// ---------------------------------------------------------------------------

	/**
	 * Run both guards against `summary`. Returns the parked summary if either guard trips, or
	 * `null` if neither fires (the caller should proceed with the original summary).
	 *
	 * Mirrors `enforceRepeatedToolCallGuard(summary) ?? enforceRepeatedFailureTargetGuard(summary)`
	 * from the original session service.
	 */
	check(summary: RuntimeTaskSessionSummary): RuntimeTaskSessionSummary | null {
		return this.enforceRepeatedToolCallGuard(summary) ?? this.enforceRepeatedFailureTargetGuard(summary);
	}

	/**
	 * Reset all guard state for a single task. Called on task start, restart, stop, abort, clear,
	 * and user-input (send) so stale fingerprints do not carry over to a fresh session.
	 *
	 * Note: `repeatedFailureTargetByTaskId` is intentionally NOT reset here — matching the
	 * original service behavior where it is only ever cleared on service dispose. Only
	 * `repeatedToolCallByTaskId` is reset per task.
	 */
	resetTask(taskId: string): void {
		this.repeatedToolCallByTaskId.delete(taskId);
	}

	/**
	 * Dispose all guard state. Called once when the session service is torn down.
	 */
	dispose(): void {
		this.repeatedToolCallByTaskId.clear();
		this.repeatedFailureTargetByTaskId.clear();
	}

	// ---------------------------------------------------------------------------
	// Guard implementations (private)
	// ---------------------------------------------------------------------------

	private enforceRepeatedToolCallGuard(summary: RuntimeTaskSessionSummary): RuntimeTaskSessionSummary | null {
		if (isHomeAgentSessionId(summary.taskId) || summary.state !== "running") {
			return null;
		}
		const toolCall = computeRepeatedToolCallCandidate(summary.latestHookActivity);
		if (!toolCall) {
			return null;
		}
		const previous = this.repeatedToolCallByTaskId.get(summary.taskId);
		const nextState: NKleinTaskRepeatedToolState =
			previous?.fingerprint === toolCall.fingerprint
				? {
						...toolCall,
						count: previous.count + 1,
					}
				: {
						...toolCall,
						count: 1,
					};
		this.repeatedToolCallByTaskId.set(summary.taskId, nextState);
		const repeatedToolCallLimit = getRepeatedToolCallLimit(
			nextState.toolName,
			this.callbacks.getMaxRepeatedToolCallsPerTask(),
		);
		if (nextState.count < repeatedToolCallLimit) {
			return null;
		}
		const entry = this.callbacks.getTaskEntry(summary.taskId);
		if (!entry || entry.summary.reviewReason === "attention") {
			return null;
		}
		return this.callbacks.parkTaskForAutonomyBudget({
			taskId: summary.taskId,
			entry,
			message: formatRepeatedToolCallParkMessage(nextState),
			metadata: {
				guardrail: "repeated_tool_calls",
				count: nextState.count,
				limit: repeatedToolCallLimit,
				toolName: nextState.toolName,
				toolInputSummary: nextState.toolInputSummary,
			},
		});
	}

	private enforceRepeatedFailureTargetGuard(summary: RuntimeTaskSessionSummary): RuntimeTaskSessionSummary | null {
		if (isHomeAgentSessionId(summary.taskId) || summary.state !== "running") {
			return null;
		}
		const target = this.readRepeatedFailureTargetCandidate(summary);
		if (!target) {
			return null;
		}
		const previous = this.repeatedFailureTargetByTaskId.get(summary.taskId);
		const toolNames = Array.from(new Set([...(previous?.toolNames ?? []), target.toolName]));
		const nextState: NKleinTaskRepeatedFailureTargetState =
			previous?.fingerprint === target.fingerprint
				? {
						fingerprint: target.fingerprint,
						count: previous.count + 1,
						targetSummary: target.targetSummary,
						toolNames,
					}
				: {
						fingerprint: target.fingerprint,
						count: 1,
						targetSummary: target.targetSummary,
						toolNames: [target.toolName],
					};
		this.repeatedFailureTargetByTaskId.set(summary.taskId, nextState);
		if (nextState.count < NKLEIN_REPEATED_PLAN_ARTIFACT_FAILURE_THRESHOLD) {
			return null;
		}
		const entry = this.callbacks.getTaskEntry(summary.taskId);
		if (!entry || entry.summary.reviewReason === "attention") {
			return null;
		}
		const toolNamesText = nextState.toolNames.join(", ");
		const isDecomposition = target.kind === "decomposition";
		const message = isDecomposition
			? `!Klein paused this task after ${nextState.count} decomposition attempts that kept failing graph validation. Open the proposed plan graph and the validation errors in the chat, then send a corrected instruction (or split the work into smaller cards) instead of re-running decompose_project.`
			: `!Klein paused this task after ${nextState.count} failed attempts to inspect the same plan artifact path (${nextState.targetSummary}) with ${toolNamesText}. Plan artifacts are trusted control-plane state; review progress, then continue from the generated cards instead of retrying sandbox file reads.`;
		return this.callbacks.parkTaskForAutonomyBudget({
			taskId: summary.taskId,
			entry,
			message,
			metadata: {
				guardrail: isDecomposition ? "repeated_decomposition_failures" : "repeated_plan_artifact_failures",
				count: nextState.count,
				limit: NKLEIN_REPEATED_PLAN_ARTIFACT_FAILURE_THRESHOLD,
				targetSummary: nextState.targetSummary,
				toolNames: nextState.toolNames,
			},
		});
	}

	private readRepeatedFailureTargetCandidate(summary: RuntimeTaskSessionSummary): {
		fingerprint: string;
		targetSummary: string;
		toolName: string;
		kind: "plan-artifact" | "decomposition";
	} | null {
		const activity = summary.latestHookActivity;
		if (activity?.source !== "nklein-sdk") {
			return null;
		}
		if (activity.hookEventName?.trim().toLowerCase() !== "tool_result") {
			return null;
		}
		if (!activity.activityText?.toLowerCase().startsWith("failed ")) {
			return null;
		}
		const toolName = activity.toolName?.trim();
		if (!toolName || isNKleinUserAttentionTool(toolName)) {
			return null;
		}
		const planArtifactTarget = normalizePlanArtifactFailureTarget(activity.toolInputSummary);
		if (planArtifactTarget) {
			return {
				fingerprint: `plan-artifact\n${planArtifactTarget}`,
				targetSummary: planArtifactTarget,
				toolName,
				kind: "plan-artifact",
			};
		}
		// A `decompose_project` that keeps failing graph validation: small models re-submit a slightly-varied
		// graph that fails the same coherence check, so the identical-full-input repeated-call guard never
		// fires and the task loops until it stalls (evidence: the DAW-foundation run). Fingerprint by the
		// tool itself so the consecutive validation failures accumulate and park the task for review —
		// independent of the input churn.
		if (toolName === "decompose_project") {
			return {
				fingerprint: "decomposition\ndecompose_project",
				targetSummary: "the proposed decomposition graph",
				toolName,
				kind: "decomposition",
			};
		}
		return null;
	}
}

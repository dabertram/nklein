/**
 * Decomposition stall/nudge collaborator (todo §5.X Phase 1 M1).
 *
 * Owns all per-task state and scheduling for two corrective-nudge paths that fire when an explicit
 * decomposition turn ends without emitting `decompose_project`:
 *
 *  1. **Chat-only nudge** (timer-driven): the model is still *running* but is streaming a chat-only
 *     prose response instead of calling the tool. A timer fires mid-stream, cancels the turn, and
 *     re-prompts to emit the tool call directly.
 *
 *  2. **Turn-end stall recovery** (called on review): the turn already ended cleanly without
 *     `decompose_project`. {@link decideDecompositionStallRecovery} classifies the shape
 *     (`decompose` or `continue_read`); this class owns the nudge count and decides whether to act.
 *
 * The actual I/O side effects (cancel + re-prompt) stay in the session service, passed as callbacks
 * so this collaborator remains focused on state + scheduling. The pure classification logic lives in
 * `src/core/decomposition-stall.ts` and is untouched.
 *
 * Call sites in the session service:
 *  - `nudger.scheduleDecompositionChatNudge(taskId)` — when a streaming assistant delta looks chat-only.
 *  - `nudger.clearDecompositionChatNudge(taskId)` — when `decompose_project` tool_call/tool_result fires.
 *  - `nudger.maybeContinueStalledDecomposition(taskId)` — when a task leaves `running` state.
 *  - `nudger.resetTask(taskId)` — on task start/restart/stop (clears state + pending timers).
 *  - `nudger.dispose()` — on service dispose (clears all timers and counts).
 */

import type { RuntimeTaskSessionMode, RuntimeTaskSessionSummary } from "../core/api-contract";
import { decideDecompositionStallRecovery } from "../core/decomposition-stall";

/**
 * Milliseconds to wait before firing the mid-stream chat-only nudge.
 * Matches `NKLEIN_DECOMPOSITION_CHAT_NUDGE_MS` in the original service.
 */
export const DECOMPOSITION_CHAT_NUDGE_MS = 25_000;

/**
 * Maximum corrective nudges (both chat-only and turn-end) allowed per task.
 * Matches `NKLEIN_DECOMPOSITION_CHAT_NUDGE_LIMIT` in the original service.
 */
export const DECOMPOSITION_CHAT_NUDGE_LIMIT = 2;

/**
 * Pattern that, when found in a running assistant delta, indicates a chat-only decomposition
 * prose response rather than a tool call. Matches `DECOMPOSITION_CHAT_REPORT_PATTERN`.
 */
// Broadened 2026-06-29 (live C1 finding): the driver narrates decompose intent in prose phrasings the old pattern
// missed ("Let me decompose this into cards", "I have a clear picture of the spec") so the nudge never fired and the
// model ran to the deadline. Added the high-signal decompose-intent tells (let me decompose / decompose this into /
// clear picture of the spec / I'll decompose …) on top of the original report/plan tells.
const DECOMPOSITION_CHAT_REPORT_PATTERN =
	/\b(?:decompose_project|decompose this (?:project|into)|decompose the (?:project|spec|specification|codebase)|let me decompose|i(?:'ll| will| am going to|'m going to| can) decompose|i(?:'ve| have) a clear picture|clear picture of the spec|decomposition tool|based on my (?:analysis|review)|current (?:state|codebase state)|specification summary|implementation plan|task graph|domain analysis)\b/i;

/**
 * True when the task is *running* and the latest assistant delta looks like a chat-only
 * decomposition prose response (not a tool call). Mirrors `isChatOnlyDecompositionActivity`.
 */
export function isChatOnlyDecompositionActivity(summary: RuntimeTaskSessionSummary): boolean {
	const activity = summary.latestHookActivity;
	if (activity?.source !== "nklein-sdk" || activity.hookEventName !== "assistant_delta") {
		return false;
	}
	const toolName = activity.toolName?.trim().toLowerCase();
	if (toolName === "decompose_project") {
		return false;
	}
	const text = `${activity.activityText ?? ""}\n${activity.finalMessage ?? ""}`;
	return DECOMPOSITION_CHAT_REPORT_PATTERN.test(text);
}

/**
 * Callbacks the session service provides to let the nudger perform I/O side effects without
 * the nudger importing or knowing about the full service.
 */
export interface DecompositionStallNudgerCallbacks {
	/** Whether `taskId` is registered as an explicit decomposition turn. */
	isExplicitDecompositionTask(taskId: string): boolean;
	/** Latest runtime summary for a task, or null if not found. */
	getTaskSummary(taskId: string): RuntimeTaskSessionSummary | null;
	/** Provider id for telemetry. */
	resolveProviderId(taskId: string): string;
	/** Model id for telemetry (returns `"unconfigured"` when unknown). */
	resolveModelId(taskId: string): string;
	/** Workspace path for telemetry. */
	resolveWorkspacePath(taskId: string): string | null;
	/** Record a self-observation event. */
	recordObservation(params: {
		taskId: string;
		workspacePath: string | null;
		providerId: string;
		modelId: string;
		message: string;
		metadata: Record<string, string | null>;
	}): void;
	/** Cancel the currently running turn; returns the post-cancel summary (which carries the session mode) or null. */
	cancelTaskTurn(taskId: string): Promise<RuntimeTaskSessionSummary | null>;
	/** Re-prompt the task with a text message. */
	sendTaskSessionInput(
		taskId: string,
		text: string,
		mode: RuntimeTaskSessionMode,
	): Promise<RuntimeTaskSessionSummary | null>;
}

/**
 * Collaborator that owns the per-task nudge state Maps and scheduling for decomposition
 * stall/nudge recovery. Constructed once by the session service and held for its lifetime.
 */
export class DecompositionStallNudger {
	private readonly nudgeHandlesByTaskId = new Map<string, NodeJS.Timeout>();
	private readonly nudgeCountsByTaskId = new Map<string, number>();

	constructor(private readonly callbacks: DecompositionStallNudgerCallbacks) {}

	// ---------------------------------------------------------------------------
	// Timer management
	// ---------------------------------------------------------------------------

	/** Cancel and clear a pending chat-only nudge timer for `taskId`. */
	clearDecompositionChatNudge(taskId: string): void {
		const handle = this.nudgeHandlesByTaskId.get(taskId);
		if (handle) {
			clearTimeout(handle);
			this.nudgeHandlesByTaskId.delete(taskId);
		}
	}

	/**
	 * Schedule a delayed chat-only nudge for `taskId` (if not already scheduled and budget
	 * remains). No-ops when the task is not an explicit decomposition turn.
	 */
	scheduleDecompositionChatNudge(taskId: string): void {
		if (!this.callbacks.isExplicitDecompositionTask(taskId)) {
			return;
		}
		if (this.nudgeHandlesByTaskId.has(taskId)) {
			return;
		}
		if ((this.nudgeCountsByTaskId.get(taskId) ?? 0) >= DECOMPOSITION_CHAT_NUDGE_LIMIT) {
			return;
		}
		const handle = setTimeout(() => {
			this.nudgeHandlesByTaskId.delete(taskId);
			void this.handleDecompositionChatNudge(taskId);
		}, DECOMPOSITION_CHAT_NUDGE_MS);
		handle.unref();
		this.nudgeHandlesByTaskId.set(taskId, handle);
	}

	// ---------------------------------------------------------------------------
	// Nudge handlers
	// ---------------------------------------------------------------------------

	/**
	 * Fired by the scheduled timer. Checks whether the task is still running and still looks
	 * chat-only, then cancels + re-prompts within budget.
	 */
	private async handleDecompositionChatNudge(taskId: string): Promise<void> {
		const summary = this.callbacks.getTaskSummary(taskId);
		if (summary?.state !== "running" || !isChatOnlyDecompositionActivity(summary)) {
			return;
		}
		const nudgeCount = this.nudgeCountsByTaskId.get(taskId) ?? 0;
		if (nudgeCount >= DECOMPOSITION_CHAT_NUDGE_LIMIT) {
			return;
		}
		this.nudgeCountsByTaskId.set(taskId, nudgeCount + 1);
		this.callbacks.recordObservation({
			taskId,
			workspacePath: this.callbacks.resolveWorkspacePath(taskId),
			providerId: this.callbacks.resolveProviderId(taskId),
			modelId: this.callbacks.resolveModelId(taskId),
			message: "!Klein interrupted chat-only decomposition prose and requested a decompose_project tool call.",
			metadata: {
				category: "decomposition_chat_only_stall",
				lastActivity: summary.latestHookActivity?.activityText ?? null,
				lastTool: summary.latestHookActivity?.toolName ?? null,
			},
		});
		const canceled = await this.callbacks.cancelTaskTurn(taskId);
		if (!canceled) {
			return;
		}
		await this.callbacks.sendTaskSessionInput(
			taskId,
			[
				"The previous turn started writing a chat-only decomposition report. Do not continue that prose.",
				'Your next assistant output must be the `decompose_project` tool call itself, with no preamble such as "let me call" or "I will".',
				"Put the summary, assumptions, plan, task graph, `minimumTaskCount`, dependencies, knowledgeDebt, and acceptance command in the tool arguments.",
				"If a read/list/size request was blocked as duplicate or already available, do not retry it.",
			].join(" "),
			canceled.mode ?? "act",
		);
	}

	/**
	 * Called when a task leaves `running` state. Inspects the turn-end facts and, if the turn
	 * ended on a clean model-stop without decomposing, re-prompts within budget.
	 *
	 * This is the hook-end stall path (distinct from the mid-stream timer path above).
	 */
	maybeContinueStalledDecomposition(taskId: string): void {
		const summary = this.callbacks.getTaskSummary(taskId);
		if (!summary) {
			return;
		}
		const activity = summary.latestHookActivity;
		const finalText = (activity?.finalMessage ?? activity?.activityText ?? "").trim();
		const nudgeCount = this.nudgeCountsByTaskId.get(taskId) ?? 0;
		const recovery = decideDecompositionStallRecovery({
			isDecompositionTask: this.callbacks.isExplicitDecompositionTask(taskId),
			state: summary.state,
			reviewReason: summary.reviewReason ?? null,
			decomposed: activity?.hookEventName === "decomposition_applied",
			lastToolName: activity?.toolName ?? null,
			endedOnQuestion: finalText.endsWith("?"),
			nudgeCount,
			nudgeLimit: DECOMPOSITION_CHAT_NUDGE_LIMIT,
		});
		if (recovery.action === "none") {
			return;
		}
		this.nudgeCountsByTaskId.set(taskId, nudgeCount + 1);
		const workspacePath = this.callbacks.resolveWorkspacePath(taskId);
		const providerId = this.callbacks.resolveProviderId(taskId);
		const modelId = this.callbacks.resolveModelId(taskId);
		if (recovery.action === "continue_read") {
			this.callbacks.recordObservation({
				taskId,
				workspacePath,
				providerId,
				modelId,
				message: "!Klein continued a decomposition turn that stalled mid read_large_file workflow.",
				metadata: {
					category: "decomposition_read_workflow_stall",
					lastActivity: activity?.activityText ?? null,
					lastTool: activity?.toolName ?? null,
				},
			});
			void this.callbacks
				.sendTaskSessionInput(
					taskId,
					[
						"Your previous turn ran read_large_file and then stopped without making another real tool call.",
						"Writing a tool call as text — for example a `<tool_call>{...}</tool_call>` block in your reasoning — does NOT execute anything; you must emit it as an actual tool call.",
						"If specification.md is not fully read yet, call read_large_file again now with the `nextCursor` value from your last read_large_file result to continue. Do not summarize or decompose until the file is fully read.",
						"Once the spec is fully read, call `decompose_project` with the full task graph.",
					].join(" "),
					"act",
				)
				.catch(() => undefined);
			return;
		}
		// action === "decompose"
		this.callbacks.recordObservation({
			taskId,
			workspacePath,
			providerId,
			modelId,
			message: "!Klein continued a decomposition turn that ended with no decompose_project tool call.",
			metadata: {
				category: "decomposition_no_tool_call_stall",
				lastActivity: activity?.activityText ?? null,
				hookEventName: activity?.hookEventName ?? null,
			},
		});
		void this.callbacks
			.sendTaskSessionInput(
				taskId,
				[
					"Your previous turn ended without calling a tool. Reasoning or thinking alone is not an answer and does not make progress.",
					"Your next assistant output must be the `decompose_project` tool call itself — not prose, not a plan written as text, not more reasoning.",
					"Put the slug, title, spec, plan, summary, task graph (with dependsOn, complexity, filesLikelyTouched, acceptanceCommand, knowledgeDebt), and minimumTaskCount in the tool arguments.",
					"specification.md is the authoritative spec; read only what you still need, then call the tool now.",
				].join(" "),
				"act",
			)
			.catch(() => undefined);
	}

	// ---------------------------------------------------------------------------
	// Lifecycle
	// ---------------------------------------------------------------------------

	/**
	 * Reset all nudge state for a single task. Called on task start, restart, or stop so stale
	 * counts and timers do not carry over to a fresh session.
	 */
	resetTask(taskId: string): void {
		this.clearDecompositionChatNudge(taskId);
		this.nudgeCountsByTaskId.delete(taskId);
	}

	/**
	 * Dispose all pending timers and counts. Called once when the session service is torn down.
	 */
	dispose(): void {
		for (const taskId of [...this.nudgeHandlesByTaskId.keys()]) {
			this.clearDecompositionChatNudge(taskId);
		}
		this.nudgeCountsByTaskId.clear();
	}
}

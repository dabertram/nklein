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
import { decideRefinementStallRecovery } from "../core/refinement-stall";

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
 * Max refinement-promotion nudges per card (one — then it parks on its own if still stuck). A sibling of the
 * decomposition nudge: a `--no-plan` refinable work card is supposed to end its brief refinement pass with
 * `begin_implementation`; a model that wanders and never promotes leaves the card in Planning with no terminal
 * outcome (todo P0.DSTALL-adjacent, live-observed `.real-runs/20260827-015045`).
 */
export const REFINEMENT_STALL_NUDGE_LIMIT = 1;

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
 * F1.7: the tool calls that ARE decomposition progress — the final submission plus the incremental
 * add_task/add_dependency construction protocol. A session actively driving any of these must never be
 * treated as chat-only prose stalling.
 */
export function isDecompositionProgressTool(toolName: string | null | undefined): boolean {
	const normalized = (toolName ?? "").trim().toLowerCase();
	return normalized === "decompose_project" || normalized === "add_task" || normalized === "add_dependency";
}

/**
 * True when the task is *running* and the latest assistant delta looks like a chat-only
 * decomposition prose response (not a tool call). Mirrors `isChatOnlyDecompositionActivity`.
 */
export function isChatOnlyDecompositionActivity(summary: RuntimeTaskSessionSummary): boolean {
	const activity = summary.latestHookActivity;
	if (activity?.source !== "nklein-sdk" || activity.hookEventName !== "assistant_delta") {
		return false;
	}
	if (isDecompositionProgressTool(activity.toolName)) {
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
	/** Whether `taskId` is a refinable `--no-plan` work card (promotes via `begin_implementation`). Refinement-nudge only. */
	isRefinableWorkCard?: (taskId: string) => boolean;
	/** Whether `taskId` already promoted to In Progress (a `begin_implementation` fired). Refinement-nudge only. */
	hasBegunImplementation?: (taskId: string) => boolean;
}

/**
 * Collaborator that owns the per-task nudge state Maps and scheduling for decomposition
 * stall/nudge recovery. Constructed once by the session service and held for its lifetime.
 */
export class DecompositionStallNudger {
	private readonly nudgeHandlesByTaskId = new Map<string, NodeJS.Timeout>();
	private readonly nudgeCountsByTaskId = new Map<string, number>();
	/** Separate budget for the refinement-promotion nudge (a task is either a decompose card OR a refinable one). */
	private readonly narratedToolCallNudgedTaskIds = new Set<string>();
	/** Exploration-drift nudge (2026-09-01, v21 architect): last CONSTRUCTION progress (add_task/add_dependency/
	 * decompose success) per plan-mode task, plus how many drift nudges were sent. A session whose turns keep
	 * "succeeding" at exploration tools while the graph stops growing triggers neither existing nudge. */
	private readonly constructionProgressAtByTaskId = new Map<string, number>();
	private readonly explorationDriftNudgeCountsByTaskId = new Map<string, number>();
	private readonly emptyFinalNudgeCountsByTaskId = new Map<string, number>();
	private readonly refinementNudgeCountsByTaskId = new Map<string, number>();

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
				"If any `add_task` calls already succeeded, those cards are still stored: do NOT add them again. Add only missing cards/edges, or call `decompose_project` WITHOUT tasks now when the graph is complete.",
				'If no card has been added yet, your next output must be one `add_task` tool call, with no preamble such as "let me call" or "I will".',
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
	maybeContinueStalledDecomposition(taskId: string): boolean {
		const summary = this.callbacks.getTaskSummary(taskId);
		if (!summary) {
			return false;
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
			return false;
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
						"If the file you were reading is not fully read yet, call read_large_file again now with the `nextCursor` value from your last read_large_file result to continue. Do not summarize or decompose until the file is fully read.",
						// This branch fires only while paging through a LARGE spec, so it steers exactly the population
						// most likely to emit a malformed giant graph. Steering it to a one-shot `decompose_project`
						// contradicted the system prompt's incremental default (G6.8a review, 2026-07-30) — the
						// `finalLooksLikeDecompositionJson` branch below stays one-shot on purpose, because there the
						// model has ALREADY written the graph and re-deriving it risks the restart spiral.
						"Once the spec is fully read, build the graph incrementally: one `add_task` call per card, then one `add_dependency` call per edge, then `decompose_project` WITHOUT `tasks`.",
						"Do not emit the whole graph as a single large `decompose_project` call — on a spec this long that is the call that most often comes back malformed.",
					].join(" "),
					"act",
				)
				.catch(() => undefined);
			return true;
		}
		// action === "decompose"
		// #30 (run31): the highest-value variant — the model already WROTE the full decomposition, but as final
		// text instead of a tool call. Tell it to re-emit exactly that content as the call; anything vaguer and a
		// model may restart its analysis from scratch (or answer in prose again).
		const finalLooksLikeDecompositionJson = finalText.startsWith("{") && /"tasks"\s*:/.test(finalText);
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
				finalLooksLikeDecompositionJson: finalLooksLikeDecompositionJson ? "true" : "false",
			},
		});
		void this.callbacks
			.sendTaskSessionInput(
				taskId,
				finalLooksLikeDecompositionJson
					? [
							"Your previous message wrote the decomposition as plain JSON text. Text output is never executed — only tool calls are.",
							"Call `decompose_project` now, passing exactly that JSON as the tool arguments.",
							"Do not rewrite, shorten, or re-derive the plan; emit the tool call with the same content.",
						].join(" ")
					: [
							"Your previous turn ended without calling a tool. Reasoning or thinking alone is not an answer and does not make progress.",
							"If any `add_task` calls already succeeded, the incremental graph is still stored. Do NOT re-add those ids. Add only missing cards/edges, or call `decompose_project` WITHOUT tasks using slug, title, spec, plan, and summary when it is complete.",
							"If no card has been added yet, your next assistant output must be one `add_task` tool call — not prose, not a plan written as text, not more reasoning.",
							"If a previous full `decompose_project` call was malformed or empty, do not retry that nested payload. The incremental calls are the required recovery path.",
						].join(" "),
				"act",
			)
			.catch(() => undefined);
		return true;
	}

	// ---------------------------------------------------------------------------
	// Lifecycle
	// ---------------------------------------------------------------------------

	/**
	 * Reset all nudge state for a single task. Called on task start, restart, or stop so stale
	 * counts and timers do not carry over to a fresh session.
	 */
	/**
	 * Refinement-promotion stall nudge — the sibling of {@link maybeContinueStalledDecomposition} for a refinable
	 * `--no-plan` work card that ended a turn in Planning without calling `begin_implementation`. One nudge per card;
	 * the gating is the pure {@link decideRefinementStallRecovery}. The service calls this ONLY when the
	 * refinement-stall nudge is enabled (off by default) and no more-specific decomposition recovery already fired.
	 */
	/**
	 * Narrated-TOOL-CALL recovery (live-found 2026-08-29, dschinn architect on Flash-Next): the model emitted a
	 * syntactically-mangled tool call as PLAIN TEXT (`[tool_call id=… name=resolve_result] {…} </parameter>
	 * </function> </tool_call>` — a slip into Qwen's XML tool dialect), the parser saw ordinary text, the agent
	 * ended its run, and the heartbeat-lost rung culled a productive session. Detection is deliberately narrow —
	 * the final text must LOOK like a tool invocation (a `[tool_call … name=…]` header or `</tool_call>` tail
	 * with a JSON body) — and recovery is ONE corrective re-prompt per session: re-issue the call for real.
	 * Applies to ANY task kind (unlike the decompose-specific rungs): a formatting slip is model-dialect, not
	 * task-shape. One-shot bound keeps a dialect-stuck model from ping-ponging forever.
	 */
	/**
	 * Empty-final recovery (live-found 2026-08-29, single remaining architect killer after the review-race fix):
	 * the model returned an EMPTY completion mid-run (a llama.cpp multi-slot degradation class), the SDK read it
	 * as the final answer, and a productive session ended as agent_end with only the "Agent active" placeholder.
	 * When a session ends with reviewReason "exit"/"hook" and NO substantive final text, send ONE "continue"
	 * re-prompt — a real empty-handed model will just end again (bounded), a glitched completion resumes work.
	 */
	maybeNudgeEmptyFinal(taskId: string): boolean {
		const summary = this.callbacks.getTaskSummary(taskId);
		if (!summary || summary.state === "running") {
			return false;
		}
		if (summary.reviewReason !== "exit" && summary.reviewReason !== "hook") {
			return false;
		}
		const activity = summary.latestHookActivity;
		if (activity?.hookEventName !== "agent_end") {
			return false;
		}
		const finalText = (activity?.finalMessage ?? "").trim();
		const placeholderOnly = finalText.length === 0 || finalText === "Agent active";
		// Bounded, env-widenable (2026-08-29): the glitch recurs every ~15-30 min of session time, so a strict
		// one-shot died on the SECOND glitch mid-decompose. Default stays 1 (a genuinely finished model ends
		// again immediately); a rig chasing a long run raises NKLEIN_EMPTY_FINAL_REDRIVE_LIMIT.
		const redriveLimit = Math.max(1, Number.parseInt(process.env.NKLEIN_EMPTY_FINAL_REDRIVE_LIMIT ?? "1", 10) || 1);
		const priorRedrives = this.emptyFinalNudgeCountsByTaskId.get(taskId) ?? 0;
		if (!placeholderOnly || priorRedrives >= redriveLimit) {
			return false;
		}
		this.emptyFinalNudgeCountsByTaskId.set(taskId, priorRedrives + 1);
		this.callbacks.recordObservation({
			taskId,
			workspacePath: this.callbacks.resolveWorkspacePath(taskId),
			providerId: this.callbacks.resolveProviderId(taskId),
			modelId: this.callbacks.resolveModelId(taskId),
			message:
				"!Klein re-drove a session whose run ended on an EMPTY final (glitched completion, not a real finish).",
			metadata: {
				category: "empty_final_redriven",
				lastTool: activity?.toolName ?? null,
			},
		});
		void this.callbacks
			.sendTaskSessionInput(
				taskId,
				[
					"Your last reply came through EMPTY (a transient inference glitch — not your fault, and the run is not finished).",
					"Continue exactly where you left off: re-issue the tool call or text you intended.",
					"If you had genuinely completed the objective, state the completion explicitly instead of an empty reply.",
				].join(" "),
				"act",
			)
			.catch(() => undefined);
		return true;
	}

	maybeNudgeNarratedToolCall(taskId: string): boolean {
		const summary = this.callbacks.getTaskSummary(taskId);
		if (!summary || summary.state === "running") {
			return false;
		}
		const activity = summary.latestHookActivity;
		const finalText = (activity?.finalMessage ?? activity?.activityText ?? "").trim();
		if (finalText.length === 0 || this.narratedToolCallNudgedTaskIds.has(taskId)) {
			return false;
		}
		const header = /\[tool_call[^\]]*name=([\w.-]+)\]/i.exec(finalText);
		const xmlTail = /<\/(?:tool_call|function|parameter)>/i.test(finalText);
		const hasJsonBody = /\{\s*"/.test(finalText);
		if (!header && !(xmlTail && hasJsonBody)) {
			return false;
		}
		const toolName = header?.[1] ?? null;
		this.narratedToolCallNudgedTaskIds.add(taskId);
		this.callbacks.recordObservation({
			taskId,
			workspacePath: this.callbacks.resolveWorkspacePath(taskId),
			providerId: this.callbacks.resolveProviderId(taskId),
			modelId: this.callbacks.resolveModelId(taskId),
			message: "!Klein recovered a tool call that was emitted as plain text (narrated tool-call slip).",
			metadata: {
				category: "narrated_tool_call_recovered",
				tool: toolName,
				finalPreview: finalText.slice(0, 120),
			},
		});
		void this.callbacks
			.sendTaskSessionInput(
				taskId,
				[
					`Your last message wrote a tool call as PLAIN TEXT${toolName ? ` (${toolName})` : ""}, so it was NOT executed — a formatting slip, not a tool failure.`,
					"Re-issue it now as a REAL tool call: same tool, same arguments, through the tool-calling channel only.",
					"Do not apologize, summarize, or re-plan — just make the call and continue where you left off.",
				].join(" "),
				"act",
			)
			.catch(() => undefined);
		return true;
	}

	/** Record real graph progress; re-arms the drift detector and (on progress) clears its nudge streak. */
	noteConstructionProgress(taskId: string): void {
		this.constructionProgressAtByTaskId.set(taskId, Date.now());
		this.explorationDriftNudgeCountsByTaskId.delete(taskId);
	}

	/**
	 * Plan-mode exploration drift (live 2026-09-01, v21): 200+ messages of successful read/search tool turns
	 * with the durable construction stuck — turns end "cleanly with tools", so neither the chat-only nudge nor
	 * the turn-end stall recovery fires. When a plan-mode session goes NKLEIN_EXPLORATION_DRIFT_NUDGE_MS
	 * (default 20min) without add_task/add_dependency/decompose progress, re-anchor it to the one-pass
	 * protocol. Bounded per drift episode; real progress resets the budget.
	 */
	maybeNudgeExplorationDrift(taskId: string, heldCardIds: readonly string[]): boolean {
		const summary = this.callbacks.getTaskSummary(taskId);
		if (!summary || summary.state !== "running") {
			return false;
		}
		const thresholdMs =
			Number(process.env.NKLEIN_EXPLORATION_DRIFT_NUDGE_MS ?? "") > 0
				? Number(process.env.NKLEIN_EXPLORATION_DRIFT_NUDGE_MS)
				: 20 * 60_000;
		const lastProgressAt = this.constructionProgressAtByTaskId.get(taskId);
		if (lastProgressAt === undefined) {
			// First sighting: arm the detector from now — a session gets a full window before its first nudge.
			this.constructionProgressAtByTaskId.set(taskId, Date.now());
			return false;
		}
		if (Date.now() - lastProgressAt < thresholdMs) {
			return false;
		}
		const nudgeCount = this.explorationDriftNudgeCountsByTaskId.get(taskId) ?? 0;
		if (nudgeCount >= 3) {
			return false;
		}
		this.explorationDriftNudgeCountsByTaskId.set(taskId, nudgeCount + 1);
		// Re-arm the window so the next nudge (if still stuck) waits another full threshold.
		this.constructionProgressAtByTaskId.set(taskId, Date.now());
		const held = heldCardIds.slice(0, 40).join(", ");
		this.callbacks.recordObservation({
			taskId,
			workspacePath: this.callbacks.resolveWorkspacePath(taskId),
			providerId: this.callbacks.resolveProviderId(taskId),
			modelId: this.callbacks.resolveModelId(taskId),
			message: `!Klein nudged a plan-mode session that made no graph progress for ${Math.round(thresholdMs / 60000)}m (exploration drift).`,
			metadata: {
				category: "decomposition_exploration_drift",
				heldCards: String(heldCardIds.length),
				nudge: String(nudgeCount + 1),
			},
		});
		void this.callbacks
			.sendTaskSessionInput(
				taskId,
				[
					`PROTOCOL RESET: you have made no graph progress (add_task/add_dependency/decompose_project) for ${Math.round(thresholdMs / 60000)} minutes — you are exploring instead of building.`,
					heldCardIds.length > 0
						? `The durable graph already holds ${heldCardIds.length} card(s): ${held}. They survive restarts — declare only NEW cards.`
						: "The durable graph is still EMPTY.",
					"Resume the ONE-PASS protocol NOW: read the NEXT unconverted specification.md section with read_large_file, then immediately add_task each card that section defines (id, title, prompt). Do not search the workspace; specification.md is the only source. When every section is converted, call decompose_project with no arguments.",
				].join(" "),
				"act",
			)
			.catch(() => undefined);
		return true;
	}

	maybeNudgeStalledRefinement(taskId: string): boolean {
		const summary = this.callbacks.getTaskSummary(taskId);
		if (!summary) {
			return false;
		}
		const activity = summary.latestHookActivity;
		const finalText = (activity?.finalMessage ?? activity?.activityText ?? "").trim();
		const nudgeCount = this.refinementNudgeCountsByTaskId.get(taskId) ?? 0;
		const decision = decideRefinementStallRecovery({
			isRefinableWorkCard: this.callbacks.isRefinableWorkCard?.(taskId) ?? false,
			begunImplementation: this.callbacks.hasBegunImplementation?.(taskId) ?? false,
			state: summary.state,
			reviewReason: summary.reviewReason ?? null,
			endedOnQuestion: finalText.endsWith("?"),
			nudgeCount,
			nudgeLimit: REFINEMENT_STALL_NUDGE_LIMIT,
		});
		if (decision.action === "none") {
			return false;
		}
		this.refinementNudgeCountsByTaskId.set(taskId, nudgeCount + 1);
		const workspacePath = this.callbacks.resolveWorkspacePath(taskId);
		const providerId = this.callbacks.resolveProviderId(taskId);
		const modelId = this.callbacks.resolveModelId(taskId);
		this.callbacks.recordObservation({
			taskId,
			workspacePath,
			providerId,
			modelId,
			message: "!Klein nudged a refinement card that ended a turn without calling begin_implementation.",
			metadata: {
				category: "refinement_promotion_stall",
				lastActivity: activity?.activityText ?? null,
				lastTool: activity?.toolName ?? null,
			},
		});
		void this.callbacks
			.sendTaskSessionInput(
				taskId,
				[
					"Your previous turn ended without calling begin_implementation, so this card is still in the Planning lane and no implementation has started.",
					"You have explored enough. Call the begin_implementation tool NOW to move the card to In Progress, then make the change the card asks for: edit the files, run the acceptance check, and finish.",
					"Do not keep exploring the workspace or reading more files first. Writing a tool call as text (e.g. a `<tool_call>{...}</tool_call>` block) does NOT execute it — emit begin_implementation as a real tool call.",
				].join(" "),
				"act",
			)
			.catch(() => undefined);
		return true;
	}

	resetTask(taskId: string): void {
		this.clearDecompositionChatNudge(taskId);
		this.nudgeCountsByTaskId.delete(taskId);
		this.refinementNudgeCountsByTaskId.delete(taskId);
		this.narratedToolCallNudgedTaskIds.delete(taskId);
		this.emptyFinalNudgeCountsByTaskId.delete(taskId);
		this.constructionProgressAtByTaskId.delete(taskId);
		this.explorationDriftNudgeCountsByTaskId.delete(taskId);
	}

	/**
	 * Dispose all pending timers and counts. Called once when the session service is torn down.
	 */
	dispose(): void {
		for (const taskId of [...this.nudgeHandlesByTaskId.keys()]) {
			this.clearDecompositionChatNudge(taskId);
		}
		this.nudgeCountsByTaskId.clear();
		this.refinementNudgeCountsByTaskId.clear();
	}
}

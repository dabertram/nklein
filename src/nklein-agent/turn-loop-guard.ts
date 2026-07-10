/**
 * Turn-loop guard collaborator (todo §12 "Agent LOOP detection + task-boundary escalation", live-observed 2026-07-10:
 * qwen3.6-35b-a3b looped endlessly re-raising "is the *.js test command correct?" when the sources were *.ts).
 *
 * Owns the per-task state + effect routing for the WITHIN-SESSION turn-loop ladder built on the pure core
 * `src/core/agent-turn-loop.ts`:
 *
 *  1. **DETECT** — on each COMPLETED assistant turn of a running session, fingerprint the trailing turns
 *     (`detectTurnLoop`) and catch the same question/proposal re-raised (`repeat`) or two proposals bounced
 *     between (`oscillation`).
 *  2. **AUTO-RESOLVE** — when the contested token is grounded in the card's authoritative context (the embedded
 *     `Acceptance check:` command / the start prompt's spec), inject the guidance as a mid-session nudge
 *     (`sendTaskSessionInput`, mirroring the decomposition stall nudger's re-prompt). Bounded: one nudge per task.
 *  3. **ESCALATE** — not auto-resolvable but a lineage-diverse loaded model exists (`pickEscalationModel`, the same
 *     probe W4.2 layer 3 uses): emit the escalation event so the runtime routes the card through the existing
 *     §5.AG ladder (card-mailbox boundary note + model override + redrive).
 *  4. **PARK** — no way out: park with reviewReason "attention" (the needs-you surface) stating the SPECIFIC
 *     contested question, never a generic "stuck".
 *
 * Identical tool-call loops are the `RepeatedToolCallGuard`'s job; THIS guard covers the textual re-ask loop that
 * guard cannot see. All I/O side effects are injected via {@link TurnLoopGuardCallbacks} (the collaborator pattern
 * of repeated-tool-call-guard.ts / decomposition-stall-nudger.ts).
 */

import {
	type AgentLoopTurn,
	DEFAULT_TURN_LOOP_POLICY,
	decideTurnLoopResolution,
	detectTurnLoop,
	extractAcceptanceCheckCommand,
	type TurnLoopPolicy,
	type TurnLoopVerdict,
} from "../core/agent-turn-loop";
import type { RuntimeTaskSessionSummary } from "../core/api-contract";
import { isHomeAgentSessionId } from "../core/home-agent-session";
import { isDerivedTaskSessionId } from "../core/synthetic-task-id";
import type { NKleinTaskSessionEntry } from "./nklein-session-state";

/** Auto-resolve nudges allowed per task session — past this the ladder moves to escalate/park. */
export const TURN_LOOP_AUTO_RESOLVE_NUDGE_LIMIT = 1;

/** Completed turns the model gets to act on a handled loop before the guard re-evaluates. */
export const TURN_LOOP_REARM_TURNS = 3;

/** A model-escalation request the runtime effects (mailbox boundary note + model override + redrive — §5.AG). */
export interface TurnLoopEscalationEvent {
	taskId: string;
	workspacePath: string | null;
	/** The contested boundary question the next attempt must receive as guidance. */
	boundary: string;
	/** The lineage-diverse loaded model the card should be redriven on. */
	model: { providerId: string; modelId: string };
	verdict: TurnLoopVerdict;
}

export interface TurnLoopGuardCallbacks {
	getTaskEntry(taskId: string): NKleinTaskSessionEntry | null;
	/**
	 * Cancel the task's in-flight turn before nudging (the stall-nudger sequence). Returns null when the run
	 * already ended on its own — the guard then drops the nudge instead of re-driving a finished session
	 * (a post-completion re-drive races the review finalization — live-found via the a-same-question regression).
	 */
	cancelTaskTurn(taskId: string): Promise<RuntimeTaskSessionSummary | null>;
	/** Inject the auto-resolve guidance as a mid-session user turn (the stall-nudger re-prompt seam). */
	sendTaskSessionInput(taskId: string, text: string): Promise<unknown>;
	/** Probe for a lineage-diverse loaded escalation model (W4.2 layer-3 seam); null ⇒ park instead. */
	pickEscalationModel(taskId: string): Promise<{ providerId: string; modelId: string } | null>;
	/** Park the task with reviewReason "attention" (the needs-you surface). */
	parkTaskForAutonomyBudget(input: {
		taskId: string;
		entry: NKleinTaskSessionEntry;
		message: string;
		metadata: Record<string, unknown>;
	}): RuntimeTaskSessionSummary;
	recordObservation(event: { taskId: string; message: string; metadata: Record<string, unknown> }): void;
	/** The runtime's §5.AG escalation effect (absent in bare unit setups ⇒ the guard parks instead). */
	onEscalateModel?: (event: TurnLoopEscalationEvent) => void | Promise<void>;
}

interface TurnLoopTaskState {
	/** Detection re-arms only once this many completed turns exist (grows by {@link TURN_LOOP_REARM_TURNS} per handling). */
	nextEligibleTurnCount: number;
	autoResolveNudgesUsed: number;
	/** An escalation/park was already routed — this guard acts at most once per task session past that point. */
	resolvedTerminally: boolean;
	/** An async resolution is in flight (detection is sync, effects are not) — suppress double-fire. */
	inFlight: boolean;
}

/** Reduce a session entry's COMPLETED assistant turns (the streaming one excluded) to loop-detection turns. */
export function collectCompletedAssistantTurns(entry: NKleinTaskSessionEntry): AgentLoopTurn[] {
	const turns: AgentLoopTurn[] = [];
	for (const message of entry.messages) {
		if (message.role !== "assistant" || message.id === entry.activeAssistantMessageId) {
			continue;
		}
		const text = message.content.trim();
		if (text.length > 0) {
			turns.push({ text });
		}
	}
	return turns;
}

/** Park message for a confirmed, unresolvable turn loop — names the SPECIFIC contested question. */
export function formatTurnLoopParkMessage(verdict: TurnLoopVerdict): string {
	const shape =
		verdict.kind === "oscillation"
			? "kept bouncing between the same two proposals"
			: "kept re-raising the same question";
	const question = verdict.contestedQuestion ? ` The contested question: "${verdict.contestedQuestion}"` : "";
	return (
		`!Klein paused this task: the agent ${shape} across ${verdict.occurrences} turns without progressing — ` +
		`a boundary it cannot resolve on its own.${question} Answer it (or adjust the task/acceptance criteria), ` +
		"then send an instruction to continue."
	);
}

export class TurnLoopGuard {
	private readonly stateByTaskId = new Map<string, TurnLoopTaskState>();

	constructor(
		private readonly callbacks: TurnLoopGuardCallbacks,
		private readonly policy: TurnLoopPolicy = DEFAULT_TURN_LOOP_POLICY,
	) {}

	/**
	 * Run detection for a running task. Cheap unless a NEW completed assistant turn arrived since the last
	 * handling; effects run async behind an in-flight latch. Call from the session event seam.
	 */
	check(taskId: string): void {
		if (isHomeAgentSessionId(taskId) || isDerivedTaskSessionId(taskId)) {
			return;
		}
		const entry = this.callbacks.getTaskEntry(taskId);
		if (entry?.summary.state !== "running" || entry.summary.reviewReason === "attention") {
			return;
		}
		// Only evaluate settled turn text: mid-stream the active assistant message is still growing.
		if (entry.activeAssistantMessageId !== null) {
			return;
		}
		const state = this.stateByTaskId.get(taskId) ?? {
			nextEligibleTurnCount: this.policy.minRepeats,
			autoResolveNudgesUsed: 0,
			resolvedTerminally: false,
			inFlight: false,
		};
		if (state.resolvedTerminally || state.inFlight) {
			return;
		}
		const turns = collectCompletedAssistantTurns(entry);
		if (turns.length < state.nextEligibleTurnCount) {
			return;
		}
		const verdict = detectTurnLoop(turns, this.policy);
		if (verdict.kind === "none") {
			return;
		}
		state.inFlight = true;
		this.stateByTaskId.set(taskId, state);
		void this.resolve(taskId, verdict, turns.length, state).finally(() => {
			state.inFlight = false;
		});
	}

	/** Reset all loop state for a task (session start/stop/clear boundaries — NOT plain user input). */
	resetTask(taskId: string): void {
		this.stateByTaskId.delete(taskId);
	}

	dispose(): void {
		this.stateByTaskId.clear();
	}

	private async resolve(
		taskId: string,
		verdict: TurnLoopVerdict,
		turnCount: number,
		state: TurnLoopTaskState,
	): Promise<void> {
		const entry = this.callbacks.getTaskEntry(taskId);
		if (!entry) {
			return;
		}
		// The card's authoritative context: the start prompt carries the spec scaffold + the embedded
		// `Acceptance check:` line (the same convention the acceptance gate and plan-integration gate read).
		const startPrompt = entry.messages.find((message) => message.role === "user")?.content ?? "";
		const decision = decideTurnLoopResolution({
			verdict,
			acceptanceCommand: extractAcceptanceCheckCommand(startPrompt),
			specContext: startPrompt,
			triedModelIds: [],
			availableModelIds: [],
		});

		if (decision.kind === "auto_resolve" && state.autoResolveNudgesUsed < TURN_LOOP_AUTO_RESOLVE_NUDGE_LIMIT) {
			// Cancel-then-send (the stall-nudger sequence): interrupt the doom loop NOW and re-prompt with the
			// guidance. A null cancel means the run already ended by itself — do NOT re-drive it (that would race
			// the review finalization); the budget stays unconsumed for a future loop in a later run.
			const canceled = await this.callbacks.cancelTaskTurn(taskId).catch(() => null);
			if (!canceled) {
				return;
			}
			state.autoResolveNudgesUsed += 1;
			state.nextEligibleTurnCount = turnCount + TURN_LOOP_REARM_TURNS;
			this.callbacks.recordObservation({
				taskId,
				message: `Turn loop auto-resolved from acceptance context (${verdict.kind} ×${verdict.occurrences}).`,
				metadata: {
					category: "turn_loop_auto_resolve",
					kind: verdict.kind,
					occurrences: verdict.occurrences,
					contestedQuestion: verdict.contestedQuestion,
				},
			});
			await this.callbacks.sendTaskSessionInput(taskId, decision.guidance).catch(() => null);
			return;
		}

		// Not groundable (or the nudge budget is spent) — §5.AG Layer 1: a lineage-diverse loaded model.
		const boundary = verdict.contestedQuestion ?? "the recurring proposal the agent cannot get past";
		const escalationModel = this.callbacks.onEscalateModel
			? await this.callbacks.pickEscalationModel(taskId).catch(() => null)
			: null;
		if (escalationModel && this.callbacks.onEscalateModel) {
			state.resolvedTerminally = true;
			this.callbacks.recordObservation({
				taskId,
				message: `Turn loop escalated to ${escalationModel.modelId} (${verdict.kind} ×${verdict.occurrences}).`,
				metadata: {
					category: "turn_loop_escalate_model",
					kind: verdict.kind,
					occurrences: verdict.occurrences,
					contestedQuestion: verdict.contestedQuestion,
					modelId: escalationModel.modelId,
				},
			});
			await Promise.resolve(
				this.callbacks.onEscalateModel({
					taskId,
					workspacePath: entry.summary.workspacePath ?? null,
					boundary,
					model: escalationModel,
					verdict,
				}),
			).catch(() => null);
			return;
		}

		// Layer 2 — park with the SPECIFIC question (the needs-you surface).
		const current = this.callbacks.getTaskEntry(taskId);
		if (!current || current.summary.reviewReason === "attention") {
			return;
		}
		state.resolvedTerminally = true;
		this.callbacks.parkTaskForAutonomyBudget({
			taskId,
			entry: current,
			message: formatTurnLoopParkMessage(verdict),
			metadata: {
				guardrail: "turn_loop",
				kind: verdict.kind,
				occurrences: verdict.occurrences,
				contestedQuestion: verdict.contestedQuestion,
			},
		});
	}
}

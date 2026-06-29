/**
 * Maps a tool-using CHAT turn into an Agent Attempt Ledger event (§5.AF) — the chat-flow WRITER, the sibling of the
 * terminal task writer (`nklein-ledger-attempt.ts`). Pure + testable; the chat-service calls `buildChatAttemptEvent`
 * and the runtime wiring appends it best-effort, so a chat agent turn becomes one durable `attempt` event with
 * `flow:"chat"` — which puts CHAT into the §5.Z matrix / §5.AA profile / §5.AB speed+outcome projections, not just
 * board task runs. Observational only: a write failure never affects the chat turn (the caller wraps the append).
 */

import { type AgentAttemptEvent, type AttemptToolCall, buildAttemptEvent } from "../core/agent-attempt-ledger";
import { hashWorkspacePathForLedger } from "./nklein-ledger-attempt";
import { buildNKleinModelRegistryKey } from "./nklein-model-registry";

export interface ChatAttemptInput {
	/** The chat session id — the ledger `workflowId`/`taskId` for a chat turn (no board task). */
	sessionId: string;
	/** The active workspace path (hashed for the ledger; null when the chat is board-independent). */
	workspacePath: string | null;
	providerId: string | null;
	modelId: string | null;
	endpoint: string | null;
	/** The tools the turn actually executed (name + lossless input fingerprint), in order. */
	toolCalls: AttemptToolCall[];
	/** True when the agent loop hit its iteration cap (a stuck/looping turn) → recorded as a `loop` outcome. */
	hitIterationLimit: boolean;
	/** The §5.Z flow this turn ran under (`chat` for an interactive send, `autonomous` for a §5.0.1 run). Default `chat`. */
	flow?: string;
	startedAt: number | null;
	endedAt: number;
}

/**
 * Build the `attempt` ledger event for one tool-using chat turn. Pure (no I/O). Coarse by construction at this stage
 * (like the terminal writer): the turn either produced a reply (`success`) or hit the iteration cap (`loop`); per-tool
 * outcomes aren't classified at the chat seam, so each executed tool is recorded with a `null` outcome (it ran; the
 * pass/fail grade a richer writer adds later). `flow:"chat"` distinguishes it from board attempts in the §5.Z matrix.
 */
export function buildChatAttemptEvent(input: ChatAttemptInput): AgentAttemptEvent {
	const outcome = input.hitIterationLimit ? "loop" : "success";
	return buildAttemptEvent({
		workflowId: input.sessionId,
		taskId: input.sessionId,
		workspacePathHash: hashWorkspacePathForLedger(input.workspacePath),
		role: null,
		flow: input.flow ?? "chat",
		attemptId: `${input.flow ?? "chat"}:${input.sessionId}:${input.endedAt}`,
		modelId: buildNKleinModelRegistryKey({
			providerId: input.providerId ?? "",
			modelId: input.modelId ?? "",
			endpoint: input.endpoint ?? "",
		}),
		endpoint: input.endpoint,
		startedAt: input.startedAt,
		completedAt: input.endedAt,
		outcome,
		qualityOk: outcome === "success",
		toolCalls: input.toolCalls,
	});
}

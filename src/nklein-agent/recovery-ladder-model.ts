/**
 * §5.AA SWARM-path turn recovery — an {@link AgentModel} decorator that wraps a BASE model's stream with the recovery
 * ladder the chat path already has, closing the gap that the SDK loop treats a text-but-no-tool-call turn as TERMINAL
 * (so `beforeModel`/`afterModel` can't re-invoke it — see §4A "SWARM turn-level recovery"). It does NOT reimplement the
 * local-LLM→SDK bridge: it decorates the config-builder's already-built model, so the provider adapter stays intact.
 *
 * Mechanism (pure over the injected `base` + policy): stream the base turn while BUFFERING its events + tracking whether
 * a tool call was emitted and the finish reason. At the end, ask the injected `shouldRecover` — a no-tool-call turn that
 * truncated (or a stalled reasoner) is a candidate. If it recovers, `reframe` the request (bump the token budget / re-word
 * the instruction) and re-stream from the base — REPLACING the buffered turn (never appending, so the assistant message
 * isn't a stale half-turn plus a recovered one). Bounded by `maxAttempts`. When no recovery fires, the buffered original
 * is replayed verbatim — byte-identical to the bare base model.
 *
 * Buffering is required: the recover-or-not decision needs the whole turn (was a tool call emitted? did it truncate?), and
 * on recovery the original must be discarded — so we can't stream live and retract. On the SWARM task path (no live-user
 * streaming) this only delays the turn's events to its end; the loop builds the assistant message from the full stream.
 *
 * The recovery POLICY is injected (`shouldRecover`/`reframe`) so this stays fully unit-testable with a fake base model;
 * the runtime supplies the real policy (`deriveTruncationSignal` for the signal + `buildPromptVariant`/`raisedTokenBudget`
 * for the reframe) when it wires this via the vendored `wrapModel` hook.
 */
import type { AgentModel, AgentModelEvent, AgentModelFinishReason, AgentModelRequest } from "@cline/shared";

/** The completed-turn signal the recovery policy decides against. */
export interface RecoveryTurnSignal {
	/** The turn's finish reason, or null if the base stream ended without a `finish` event. */
	finishReason: AgentModelFinishReason | null;
	/** Whether the turn emitted ANY tool-call (a `tool-call-delta`) — a successful action turn is never recovered. */
	hadToolCall: boolean;
	/** Whether tools were offered this turn — no point recovering a no-tool-call turn that had no tools to call. */
	offeredTools: boolean;
	/** 0-based count of recovery re-invokes ALREADY taken this turn (0 on the first, real attempt). */
	attempt: number;
}

export interface RecoveryLadderModelDeps {
	/** The base model to decorate (the config-builder's `apiHandlerToAgentModel` output). */
	base: AgentModel;
	/** Max recovery re-invokes per turn (bounded so a stuck model can't spin). Default 1. Clamped to ≥ 0. */
	maxAttempts?: number;
	/** Decide whether a completed turn should be re-invoked. A no-tool-call turn that truncated is the canonical case. */
	shouldRecover(signal: RecoveryTurnSignal): boolean;
	/** Re-frame the request for the next attempt (e.g. bump the token budget, re-word the last instruction). Pure. */
	reframe(request: AgentModelRequest, attempt: number): AgentModelRequest;
}

/**
 * Wrap `deps.base` with the recovery ladder. Returns a new {@link AgentModel} whose `stream` recovers a stalled
 * (no-tool-call) turn per the injected policy. Default-inert-ish: if `shouldRecover` always returns false, it is a
 * transparent pass-through (buffered replay) of the base model.
 */
export function createRecoveryLadderModel(deps: RecoveryLadderModelDeps): AgentModel {
	const maxAttempts = Number.isFinite(deps.maxAttempts) ? Math.max(0, Math.trunc(deps.maxAttempts as number)) : 1;
	return {
		stream(request: AgentModelRequest): AsyncIterable<AgentModelEvent> {
			return streamWithRecovery(deps, request, 0, maxAttempts);
		},
	};
}

async function* streamWithRecovery(
	deps: RecoveryLadderModelDeps,
	request: AgentModelRequest,
	attempt: number,
	maxAttempts: number,
): AsyncGenerator<AgentModelEvent> {
	const buffered: AgentModelEvent[] = [];
	let hadToolCall = false;
	let finishReason: AgentModelFinishReason | null = null;

	const iterable = await deps.base.stream(request);
	for await (const event of iterable) {
		buffered.push(event);
		if (event.type === "tool-call-delta") {
			hadToolCall = true;
		} else if (event.type === "finish") {
			finishReason = event.reason;
		}
	}

	if (
		attempt < maxAttempts &&
		deps.shouldRecover({ finishReason, hadToolCall, offeredTools: request.tools.length > 0, attempt })
	) {
		// Re-invoke with a re-framed request; the recovered turn REPLACES this one (buffered events discarded).
		yield* streamWithRecovery(deps, deps.reframe(request, attempt), attempt + 1, maxAttempts);
		return;
	}

	// No recovery — replay the base turn verbatim (byte-identical to the bare model).
	for (const event of buffered) {
		yield event;
	}
}

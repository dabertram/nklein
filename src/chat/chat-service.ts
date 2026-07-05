import { join } from "node:path";
import type {
	RuntimeChatCreateSessionRequest,
	RuntimeChatMessage,
	RuntimeChatSession,
	RuntimeChatUpdateSessionRequest,
} from "../core/chat-api-contract";
import {
	type MessageTargetIndex,
	renderMessageTargetNote,
	resolveMessageTarget,
} from "../core/message-target-resolver";
import { type ChatAgentTurnDeps, runChatAgentTurn } from "./chat-agent-turn";
import type { AutonomousChatAgentBudget, AutonomousChatAgentResult } from "./chat-autonomous-loop";
import { readAutonomousChatPlanProgress, runAutonomousChatSession } from "./chat-autonomous-wiring";
import type { ChatToolSet } from "./chat-board-tools";
import type { ChatModelDeps } from "./chat-local-llm-adapter";
import { readChatMemories } from "./chat-memory-store";
import { runChatTurn } from "./chat-runtime";
import type { ChatSession } from "./chat-session-store";
import {
	createChatSession,
	deleteChatSession,
	getChatSession,
	listChatSessions,
	updateChatSession,
} from "./chat-session-store";
import type { ChatMessage } from "./chat-transcript-store";
import { appendChatMessage, readChatTranscript } from "./chat-transcript-store";
import { decideChatModelGate } from "./local-chat-model";

/**
 * Board-independent chat service (todo §5.M) — the single aggregation seam over the chat session + transcript
 * stores that the runtime API (and the future Signal bridge) drive. It owns the wire mapping (store `ChatSession` /
 * `ChatMessage` → the contract's `RuntimeChatSession` / `RuntimeChatMessage`, dropping `schemaVersion`) and the
 * store-root layout (each store gets its own subdir under one base root), so the transport layers never touch the
 * stores directly. The root is injectable: production omits it (real runtime home); tests pass a temp dir.
 */

/**
 * The tool-using subset of {@link ChatAgentTurnDeps} a session needs to run through the agent loop instead of plain
 * completion: the tools-aware model, the policy-gated executor, and the message-fold. The service stays decoupled
 * from the concrete tool infrastructure — it only consumes this injected shape (the live wiring in `runtime-api`
 * builds the read-only tools + gated executor + agent model and supplies them).
 */
export type ChatAgentToolDeps = Pick<
	ChatAgentTurnDeps,
	"model" | "executeTool" | "appendToolExchange" | "readFocusChain"
>;

export interface ChatServiceOptions {
	/** Base directory for all chat stores; each store lives in its own subdir. Omit for the real runtime home. */
	rootDir?: string;
	now?: () => number;
	/** Resolves the model completion deps for `sendMessage` (called per turn so discovery/errors surface then).
	 *  Omit for a read-only service (sessions + transcript only); `sendMessage` then throws. */
	resolveModelDeps?: () => Promise<ChatModelDeps>;
	/** Resolves the tool-using agent deps for a session (todo §5.M G3a). Non-null ⇒ `sendMessage` routes the turn
	 *  through the tool-using agent loop (`runChatAgentTurn`) with those deps; null ⇒ the plain `runChatTurn` path.
	 *  Mirrors the `resolveModelDeps` seam so the service never touches the tool infrastructure. Omitted ⇒ always
	 *  plain (every session stays on `runChatTurn`). */
	resolveAgentToolDeps?: (session: ChatSession, extra?: ChatToolSet) => Promise<ChatAgentToolDeps | null>;
	/** §5.AL: the active project's effective model-gate policy (global default ← per-project override) used as the gate's
	 *  base, so chat honors a per-project policy like task-start does (the env knobs still layer on top). Omit ⇒ env+default. */
	resolveModelGatePolicyBase?: () => Promise<{ onUnsuitable: string; onUnknown: string } | null>;
	/** §5.AC: the resolved "knows today" switch for this turn (the runtime-config setting, OFF BY DEFAULT). Read per turn
	 *  so a live config change takes effect immediately. Omitted ⇒ the turn's env fallback (`NKLEIN_KNOWS_TODAY`) decides. */
	resolveKnowsTodayEnabled?: () => boolean;
	/** §5.AF best-effort ledger sink for a tool-using chat turn (the chat-flow writer). Called AFTER the turn with the
	 *  chat-specific attempt facts; the wiring assembles the envelope (workspace/provider/endpoint) + appends. Fire-and-
	 *  forget — must never affect the turn (the implementation swallows its own errors). Omit to not write the ledger. */
	recordChatAttempt?: (input: {
		sessionId: string;
		modelId: string;
		toolNames: readonly string[];
		hitIterationLimit: boolean;
		/** `chat` for an interactive send, `autonomous` for a §5.0.1 run turn (the §5.Z flow). */
		flow: "chat" | "autonomous";
		startedAt: number;
		endedAt: number;
	}) => void;
	/** Token estimator for the lean-window budget; defaults to ≈4 chars/token. */
	estimateTokens?: (text: string) => number;
	/** §5.AU: the card/stream index of the session's board, for message-target resolution (the addressing ladder).
	 *  Called per tool-using turn; null (or omitted) ⇒ every message routes to the goal (today's behavior). */
	resolveMessageTargetIndex?: (session: ChatSession) => Promise<MessageTargetIndex | null>;
}

export interface ChatSendResult {
	userMessage: RuntimeChatMessage;
	assistantMessage: RuntimeChatMessage;
	/** §5.AL/§5.AG: a model-capability caveat to surface (warn/unknown verdict — the turn still ran). Null when none. */
	capabilityNotice?: string | null;
	/** §5.AU: the resolved target's "talking to X" label (card/stream/answer), or null for a goal-routed turn. */
	targetLabel?: string | null;
}

function toRuntimeChatSession(session: ChatSession): RuntimeChatSession {
	return {
		id: session.id,
		title: session.title,
		scope: session.scope,
		role: session.role,
		goal: session.goal,
		riskAcknowledged: session.riskAcknowledged,
		browserEnabled: session.browserEnabled,
		feedbackMuted: session.feedbackMuted,
		focus: session.focus,
		ownedWorkspaceId: session.ownedWorkspaceId,
		selectedSkillIds: [...session.selectedSkillIds],
		totalTokensUsed: session.totalTokensUsed,
		createdAt: session.createdAt,
		updatedAt: session.updatedAt,
	};
}

function toRuntimeChatMessage(message: ChatMessage): RuntimeChatMessage {
	return { id: message.id, role: message.role, content: message.content, createdAt: message.createdAt };
}

export interface ChatService {
	listSessions: () => Promise<RuntimeChatSession[]>;
	getSession: (id: string) => Promise<RuntimeChatSession | null>;
	createSession: (input: RuntimeChatCreateSessionRequest) => Promise<RuntimeChatSession>;
	updateSession: (input: RuntimeChatUpdateSessionRequest) => Promise<RuntimeChatSession | null>;
	deleteSession: (id: string) => Promise<boolean>;
	readTranscript: (sessionId: string, limit?: number) => Promise<RuntimeChatMessage[]>;
	/** Run one chat turn against a session (composes memory + goal, calls the model, persists both messages).
	 *  Returns null when the session doesn't exist; throws when no model is configured. `onToken` (server-side only;
	 *  callbacks can't cross the tRPC wire) streams the assistant reply incrementally when the model supports it. */
	sendMessage: (
		input: {
			sessionId: string;
			message: string;
			tokenBudget?: number;
			memoryLimit?: number;
		},
		onToken?: (delta: string) => void,
	) => Promise<ChatSendResult | null>;
	/** Drive an autonomous run (todo §5.0.1): the agent works the goal turn-by-turn (plan via the focus chain, use the
	 *  gated tools + the control tools) until the goal is done, it needs the user, or a budget/stall guard trips.
	 *  Returns null when the session doesn't exist; throws when no model is configured. Each turn persists to the
	 *  transcript; meant to be driven in the background since it can run many turns. */
	runAutonomous: (input: {
		sessionId: string;
		goal: string;
		budget: AutonomousChatAgentBudget;
		maxIterationsPerTurn?: number;
	}) => Promise<AutonomousChatAgentResult | null>;
}

const DEFAULT_CHAT_TOKEN_BUDGET = 8000;
const DEFAULT_CHAT_MEMORY_LIMIT = 5;

export function createChatService(options: ChatServiceOptions = {}): ChatService {
	const { rootDir, now } = options;
	// One base root, per-store subdirs (each store joins its own filename onto the dir it's given).
	const sessionOptions = { ...(rootDir ? { rootDir: join(rootDir, "sessions") } : {}), ...(now ? { now } : {}) };
	const transcriptOptions = {
		...(rootDir ? { rootDir: join(rootDir, "transcripts") } : {}),
		...(now ? { now } : {}),
	};
	const memoryOptions = { ...(rootDir ? { rootDir: join(rootDir, "memories") } : {}), ...(now ? { now } : {}) };
	const estimateTokens = options.estimateTokens ?? ((text: string) => Math.ceil(text.length / 4));

	// Bug-hunt fix (2026-07-05): serialize whole TURNS per session id. sendMessage/runAutonomous each append a user
	// message, run the (potentially long) model+tool loop, then append the assistant reply — two separate awaited
	// writes with nothing serializing them against a SECOND concurrent turn on the SAME session. Turn A's user append,
	// then turn B's user+assistant appends interleaving before turn A's own assistant append, corrupts the
	// user→assistant transcript pairing every later read relies on. A second turn for a session already mid-flight now
	// waits for the first to finish (matching how one conversation is expected to behave); turns on DIFFERENT sessions
	// stay fully concurrent — this never serializes across sessions.
	const sessionTurnChains = new Map<string, Promise<unknown>>();
	function serializeSessionTurn<T>(sessionId: string, fn: () => Promise<T>): Promise<T> {
		const prior = sessionTurnChains.get(sessionId) ?? Promise.resolve();
		const settled = prior.then(fn, fn);
		sessionTurnChains.set(
			sessionId,
			settled.catch(() => undefined),
		);
		return settled;
	}

	return {
		listSessions: async () => {
			const sessions = await listChatSessions(sessionOptions);
			// Newest-updated first so the UI's most-recent session is at the top.
			return sessions.sort((left, right) => right.updatedAt - left.updatedAt).map(toRuntimeChatSession);
		},
		getSession: async (id) => {
			const session = await getChatSession(id, sessionOptions);
			return session ? toRuntimeChatSession(session) : null;
		},
		createSession: async (input) => {
			const session = await createChatSession(
				{
					title: input.title,
					...(input.scope ? { scope: input.scope } : {}),
					...(input.role ? { role: input.role } : {}),
					...(input.goal !== undefined ? { goal: input.goal } : {}),
					...(input.riskAcknowledged !== undefined ? { riskAcknowledged: input.riskAcknowledged } : {}),
					...(input.browserEnabled !== undefined ? { browserEnabled: input.browserEnabled } : {}),
					...(input.feedbackMuted !== undefined ? { feedbackMuted: input.feedbackMuted } : {}),
					...(input.ownedWorkspaceId !== undefined ? { ownedWorkspaceId: input.ownedWorkspaceId } : {}),
					...(input.selectedSkillIds !== undefined ? { selectedSkillIds: input.selectedSkillIds } : {}),
				},
				sessionOptions,
			);
			return toRuntimeChatSession(session);
		},
		updateSession: async (input) => {
			const session = await updateChatSession(
				input.id,
				{
					...(input.title !== undefined ? { title: input.title } : {}),
					...(input.scope ? { scope: input.scope } : {}),
					...(input.role ? { role: input.role } : {}),
					...(input.goal !== undefined ? { goal: input.goal } : {}),
					...(input.riskAcknowledged !== undefined ? { riskAcknowledged: input.riskAcknowledged } : {}),
					...(input.browserEnabled !== undefined ? { browserEnabled: input.browserEnabled } : {}),
					...(input.feedbackMuted !== undefined ? { feedbackMuted: input.feedbackMuted } : {}),
					...(input.clearFocus ? { focus: null } : {}),
					...(input.selectedSkillIds !== undefined ? { selectedSkillIds: input.selectedSkillIds } : {}),
				},
				sessionOptions,
			);
			return session ? toRuntimeChatSession(session) : null;
		},
		deleteSession: (id) => deleteChatSession(id, sessionOptions),
		readTranscript: async (sessionId, limit) => {
			const messages = await readChatTranscript(sessionId, {
				...transcriptOptions,
				...(typeof limit === "number" ? { limit } : {}),
			});
			return messages.map(toRuntimeChatMessage);
		},
		sendMessage: (input, onToken) =>
			serializeSessionTurn(input.sessionId, async () => {
				if (!options.resolveModelDeps) {
					throw new Error("This chat service is read-only: no model is configured for sending messages.");
				}
				const session = await getChatSession(input.sessionId, sessionOptions);
				if (!session) {
					return null;
				}
				const modelDeps = await options.resolveModelDeps();
				const tokenBudget = input.tokenBudget ?? DEFAULT_CHAT_TOKEN_BUDGET;
				const memoryLimit = input.memoryLimit ?? DEFAULT_CHAT_MEMORY_LIMIT;
				// §5.AC: resolve the "knows today" switch per turn (config || env, off by default) so a live config change
				// applies immediately; undefined ⇒ the renderer's env fallback decides. Threaded into the turn deps below.
				const knowsTodayEnabled = options.resolveKnowsTodayEnabled?.();
				const storeDeps = {
					readTranscript: (sessionId: string) => readChatTranscript(sessionId, transcriptOptions),
					readMemories: () => readChatMemories(memoryOptions),
					appendMessage: (sessionId: string, message: { role: ChatMessage["role"]; content: string }) =>
						appendChatMessage(sessionId, message, transcriptOptions),
					estimateTokens,
					...(knowsTodayEnabled !== undefined ? { knowsTodayEnabled } : {}),
				};

				// Tool-using path (todo §5.M G3a): when the session resolves agent tool deps, drive the tool-using agent
				// loop instead of plain completion. `onToken` still streams the FINAL (no-tool) reply (hybrid streaming), so
				// a turn that uses no tools keeps token-by-token streaming. `summarize` for the lean window comes from the
				// plain model deps. Null ⇒ fall through to the plain `runChatTurn` path below (e.g. no active workspace).
				const agentToolDeps = options.resolveAgentToolDeps ? await options.resolveAgentToolDeps(session) : null;
				if (agentToolDeps) {
					// §5.AL capability gate (web-ui/API chat path): the tool-using agent needs a tool-capable model, so refuse a
					// catalog-`reject` model up front (e.g. a reasoning-only variant) rather than burning the turn on a model that
					// can't drive tools. Override with NKLEIN_ALLOW_UNSUITABLE_MODEL=1; warn/unknown proceed. Only when the model
					// id is known (the live local resolver supplies it); a fake/test modelDeps without it is unaffected.
					let capabilityNotice: string | null = null;
					if (modelDeps.modelId) {
						const policyBase = options.resolveModelGatePolicyBase
							? await options.resolveModelGatePolicyBase()
							: null;
						const gate = decideChatModelGate(modelDeps.modelId, {
							toolUsing: true,
							allowOverride: process.env.NKLEIN_ALLOW_UNSUITABLE_MODEL === "1",
							...(policyBase ? { policyBase } : {}),
						});
						if (gate.action === "reject") {
							throw new Error(gate.message);
						}
						if (gate.action === "warn") {
							capabilityNotice = gate.message;
						}
					}
					// §5.AU rung-1+ wiring: resolve WHO the message addresses (explicit @handle → reply-bind → focus → goal)
					// against the session's board index, lead the turn with the rendered note, and persist an explicit
					// handle as the session's new focus. Goal turns add nothing (prompt stays byte-identical — §5.AQ).
					let targetNote: string | null = null;
					let targetLabel: string | null = null;
					if (options.resolveMessageTargetIndex) {
						const index = await options.resolveMessageTargetIndex(session);
						if (index) {
							const target = resolveMessageTarget({
								text: input.message,
								outstandingAsks: session.outstandingAsks,
								focus: session.focus,
								lastReferencedTaskId: session.focus?.kind === "card" ? session.focus.id : null,
								index,
							});
							targetNote = renderMessageTargetNote(target);
							targetLabel = target.kind === "goal" ? null : (target.displayLabel ?? null);
							if (
								target.source === "explicit_handle" &&
								target.id &&
								(target.kind === "card" || target.kind === "stream")
							) {
								await updateChatSession(
									session.id,
									{ focus: { kind: target.kind, id: target.id, at: (options.now ?? Date.now)() } },
									sessionOptions,
								);
							}
						}
					}
					const turnStartedAt = Date.now();
					const agentResult = await runChatAgentTurn(
						{
							session,
							userMessage: input.message,
							tokenBudget,
							memoryLimit,
							...(onToken ? { onToken } : {}),
							...(targetNote ? { targetNote } : {}),
						},
						{ ...storeDeps, summarize: modelDeps.summarize, ...agentToolDeps },
					);
					// §5.AF: best-effort append a `chat`-flow attempt event to the ledger (observational; never throws into
					// the turn — the sink swallows its own errors). Only when the model id is known.
					if (options.recordChatAttempt && modelDeps.modelId) {
						options.recordChatAttempt({
							sessionId: session.id,
							modelId: modelDeps.modelId,
							toolNames: agentResult.steps.map((step) => step.toolCall.name),
							hitIterationLimit: agentResult.hitIterationLimit,
							flow: "chat",
							startedAt: turnStartedAt,
							endedAt: Date.now(),
						});
					}
					// §5.M: accumulate this turn's token usage onto the session's running total (best-effort display metric).
					// `addTokensUsed` (not a precomputed `session.totalTokensUsed + …`) so concurrent turns on one session
					// don't race on a stale locally-held total (bug-hunt 2026-07-05: last-writer-wins lost updates).
					if (agentResult.totalTokens > 0) {
						await updateChatSession(session.id, { addTokensUsed: agentResult.totalTokens }, sessionOptions);
					}
					return {
						userMessage: toRuntimeChatMessage(agentResult.userMessage),
						assistantMessage: toRuntimeChatMessage(agentResult.assistantMessage),
						...(capabilityNotice ? { capabilityNotice } : {}),
						...(targetLabel ? { targetLabel } : {}),
					};
				}

				const result = await runChatTurn(
					{
						session,
						userMessage: input.message,
						tokenBudget,
						memoryLimit,
						...(onToken ? { onToken } : {}),
					},
					{ ...storeDeps, ...modelDeps },
				);
				return {
					userMessage: toRuntimeChatMessage(result.userMessage),
					assistantMessage: toRuntimeChatMessage(result.assistantMessage),
				};
			}),
		runAutonomous: (input) =>
			serializeSessionTurn(input.sessionId, async () => {
				if (!options.resolveModelDeps) {
					throw new Error("This chat service is read-only: no model is configured for autonomous runs.");
				}
				const session = await getChatSession(input.sessionId, sessionOptions);
				if (!session) {
					return null;
				}
				const modelDeps = await options.resolveModelDeps();
				const tokenBudget = DEFAULT_CHAT_TOKEN_BUDGET;
				const memoryLimit = DEFAULT_CHAT_MEMORY_LIMIT;
				// §5.AC: same per-turn "knows today" resolution as the interactive path (config || env, off by default).
				const knowsTodayEnabled = options.resolveKnowsTodayEnabled?.();
				const storeDeps = {
					readTranscript: (sessionId: string) => readChatTranscript(sessionId, transcriptOptions),
					readMemories: () => readChatMemories(memoryOptions),
					appendMessage: (sessionId: string, message: { role: ChatMessage["role"]; content: string }) =>
						appendChatMessage(sessionId, message, transcriptOptions),
					estimateTokens,
					...(knowsTodayEnabled !== undefined ? { knowsTodayEnabled } : {}),
				};
				const resolveAgentToolDeps = options.resolveAgentToolDeps;
				return runAutonomousChatSession(input.goal, {
					// Each turn re-resolves the gated tool deps WITH that turn's control tools merged in (the runtime-api
					// resolver's `extra`); the agent thus gets the work tools + request_user_input / declare_goal_complete.
					assembleTurnDeps: (extra) =>
						resolveAgentToolDeps ? resolveAgentToolDeps(session, extra) : Promise.resolve(null),
					runAgentTurn: async ({ userMessage, maxIterations }, agentToolDeps) => {
						const turnStartedAt = Date.now();
						const turn = await runChatAgentTurn(
							{ session, userMessage, tokenBudget, memoryLimit, ...(maxIterations ? { maxIterations } : {}) },
							{ ...storeDeps, summarize: modelDeps.summarize, ...agentToolDeps },
						);
						// §5.AF: best-effort `autonomous`-flow ledger attempt per autonomous turn (observational; never throws).
						if (options.recordChatAttempt && modelDeps.modelId) {
							options.recordChatAttempt({
								sessionId: session.id,
								modelId: modelDeps.modelId,
								toolNames: turn.steps.map((step) => step.toolCall.name),
								hitIterationLimit: turn.hitIterationLimit,
								flow: "autonomous",
								startedAt: turnStartedAt,
								endedAt: Date.now(),
							});
						}
						// §5.M: accumulate this turn's token usage (bug-hunt 2026-07-05 — the autonomous path never did this,
						// unlike sendMessage, so totalTokensUsed was frozen for an autonomous session however many turns it ran).
						if (turn.totalTokens > 0) {
							await updateChatSession(session.id, { addTokensUsed: turn.totalTokens }, sessionOptions);
						}
						return { finalText: turn.assistantMessage.content, steps: turn.steps };
					},
					readPlanProgress: () => readAutonomousChatPlanProgress(session.id),
					budget: input.budget,
					...(input.maxIterationsPerTurn ? { maxIterationsPerTurn: input.maxIterationsPerTurn } : {}),
				});
			}),
	};
}

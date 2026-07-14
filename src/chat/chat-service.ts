import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type {
	RuntimeChatClarifyCandidate,
	RuntimeChatCreateSessionRequest,
	RuntimeChatMessage,
	RuntimeChatSession,
	RuntimeChatUpdateSessionRequest,
} from "../core/chat-api-contract";
import type { ChatImageAttachment } from "../core/chat-multimodal";
import { buildTargetPickerPrompt, parseTargetPickerChoice } from "../core/message-target-picker";
import {
	type MessageTargetIndex,
	type ResolvedMessageTarget,
	renderMessageTargetNote,
	resolveMessageTarget,
	resolveTargetFromCandidate,
} from "../core/message-target-resolver";
import { type ChatAgentTurnDeps, runChatAgentTurn } from "./chat-agent-turn";
import type { AutonomousChatAgentBudget, AutonomousChatAgentResult } from "./chat-autonomous-loop";
import { readAutonomousChatPlanProgress, runAutonomousChatSession } from "./chat-autonomous-wiring";
import type { ChatToolSet } from "./chat-board-tools";
import { maybeEnforceReasoning } from "./chat-enforced-reasoning";
import { readChatMessageImages, writeChatMessageImages } from "./chat-image-store";
import type { ChatModelDeps } from "./chat-local-llm-adapter";
import { appendChatMemory, readChatMemories, writeConsolidatedMemories } from "./chat-memory-store";
import { runChatTurn } from "./chat-runtime";
import type { ChatSession } from "./chat-session-store";
import {
	createChatSession,
	deleteChatSession,
	getChatSession,
	listChatSessions,
	updateChatSession,
} from "./chat-session-store";
import type { ChatSteeringMessage, ChatTurnDeliveryMode } from "./chat-steering";
import { resolveChatTokenBudget } from "./chat-token-budget";
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
	"model" | "executeTool" | "appendToolExchange" | "readFocusChain" | "offeredToolNames"
> & {
	/** Optional controller-owned cap for this resolved tool set, e.g. a run-phase inner-loop budget. */
	maxIterations?: number;
};

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
	/** F2.7b: the selected model's normalized llmfit capability ids (e.g. `["vision"]`) — gates image attachments.
	 *  Omit ⇒ [] ⇒ attachments are refused (fail-closed: never send images to a model not known to read them). */
	resolveModelCapabilityIds?: (modelId: string) => Promise<readonly string[]>;
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
		/** §5.AF: the deepest §5.AA recovery rung that fired this turn (last one the loop saw), or null. */
		promptStrategy?: string | null;
		startedAt: number;
		endedAt: number;
	}) => void;
	/** Token estimator for the lean-window budget; defaults to ≈4 chars/token. */
	estimateTokens?: (text: string) => number;
	/** §5.AU: the card/stream index of the session's board, for message-target resolution (the addressing ladder).
	 *  Called per tool-using turn; null (or omitted) ⇒ every message routes to the goal (today's behavior). */
	resolveMessageTargetIndex?: (session: ChatSession) => Promise<MessageTargetIndex | null>;
	/**
	 * §5.AU item 9 (deterministic relay): when the resolved target addresses a specific card (`card`, or `answer` = a
	 * reply to a card's question), RELAY the message straight to that card via the shared relay path and return the
	 * confirmation to post as the assistant reply — instead of answering it in the chat with a model turn. Returns null to
	 * fall through to the normal model turn (goal / needs_clarify / stream, or when the caller declines). Injected by the
	 * runtime (which holds the board + task-session + mailbox deps); omitted ⇒ today's answer-in-chat behavior.
	 */
	relayAddressedMessage?: (target: ResolvedMessageTarget, message: string) => Promise<string | null>;
	/** §5.M ≥32k-floor budget integration: the active model's effective context window (tokens), used to size the chat
	 *  lean window against the ≥32k floor. Omit/null ⇒ the ≥32k-floor default (8k lean window, byte-identical to before). */
	resolveContextWindowTokens?: () => number | null;
	/** F2.19b/F2.20b: build the `klein_self` corpus grounding note (routed docs + real freshness citations) for a
	 *  question. Injected by the runtime (holds the source-repo path + git); omitted ⇒ no corpus note (today's
	 *  behavior). Only invoked for a `klein_self`-scoped session. */
	buildKleinSelfCorpusNote?: (session: ChatSession, question: string) => Promise<string | null>;
}

export interface ChatSendResult {
	userMessage: RuntimeChatMessage;
	assistantMessage: RuntimeChatMessage;
	/** §5.AL/§5.AG: a model-capability caveat to surface (warn/unknown verdict — the turn still ran). Null when none. */
	capabilityNotice?: string | null;
	/** §5.AU: the resolved target's "talking to X" label (card/stream/answer), or null for a goal-routed turn. */
	targetLabel?: string | null;
	/** §5.AU item 9: when the message's target was AMBIGUOUS, the candidates for the composer's picker (model didn't run). */
	clarifyCandidates?: RuntimeChatClarifyCandidate[];
	/** W3.4: TRUE when this turn's context window overflowed and older messages were rolled into a summary. */
	contextTruncated?: boolean;
}

export interface ChatSteerTurnResult {
	ok: boolean;
	delivery: ChatTurnDeliveryMode;
	message: RuntimeChatMessage | null;
	error?: string;
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
		sandboxWritablePaths: [...session.sandboxWritablePaths],
		feedbackMuted: session.feedbackMuted,
		feedbackVerbosity: session.feedbackVerbosity,
		feedbackQuiet: session.feedbackQuiet,
		focus: session.focus,
		ownedWorkspaceId: session.ownedWorkspaceId,
		selectedSkillIds: [...session.selectedSkillIds],
		totalTokensUsed: session.totalTokensUsed,
		createdAt: session.createdAt,
		updatedAt: session.updatedAt,
	};
}

function toRuntimeChatMessage(message: ChatMessage): RuntimeChatMessage {
	return {
		id: message.id,
		role: message.role,
		content: message.content,
		createdAt: message.createdAt,
		...(message.meta ? { meta: message.meta } : {}),
	};
}

/** W3.1: a live tool-activity event streamed to the composer while the turn runs. */
export interface ChatToolActivityEvent {
	phase: "start" | "end";
	toolName: string;
}

/**
 * W3.1: render one tool exchange as the transcript's `role:"tool"` message body — the exact `Tool:/Input:/Output:`
 * text protocol the shared renderer's `parseToolMessageContent` reads (mirrors the per-card event adapter).
 */
function renderToolTranscriptContent(
	call: { name: string; arguments: Record<string, unknown> },
	output: string,
): string {
	const sections = [`Tool: ${call.name}`];
	const args = Object.keys(call.arguments).length > 0 ? JSON.stringify(call.arguments, null, 2) : "";
	if (args) {
		sections.push("Input:", args);
	}
	if (output.trim().length > 0) {
		sections.push("Output:", output);
	}
	return sections.join("\n");
}

export interface ChatService {
	listSessions: () => Promise<RuntimeChatSession[]>;
	getSession: (id: string) => Promise<RuntimeChatSession | null>;
	createSession: (input: RuntimeChatCreateSessionRequest) => Promise<RuntimeChatSession>;
	updateSession: (input: RuntimeChatUpdateSessionRequest) => Promise<RuntimeChatSession | null>;
	deleteSession: (id: string) => Promise<boolean>;
	readTranscript: (sessionId: string, limit?: number) => Promise<RuntimeChatMessage[]>;
	/** F2.7b: a message's out-of-band image attachments (data-URL-ready), for history rendering; [] when none. */
	getMessageImages: (sessionId: string, messageId: string) => Promise<ChatImageAttachment[]>;
	/** Run one chat turn against a session (composes memory + goal, calls the model, persists both messages).
	 *  Returns null when the session doesn't exist; throws when no model is configured. `onToken` (server-side only;
	 *  callbacks can't cross the tRPC wire) streams the assistant reply incrementally when the model supports it. */
	sendMessage: (
		input: {
			sessionId: string;
			message: string;
			tokenBudget?: number;
			memoryLimit?: number;
			/** F2.7b: image attachments for this turn (sent to the model only when it claims vision + they fit budget). */
			imageAttachments?: readonly ChatImageAttachment[];
		},
		onToken?: (delta: string) => void,
		/** W3.1 (server-side only): live tool start/end activity while the turn runs, for the composer's chips. */
		onToolEvent?: (event: ChatToolActivityEvent) => void,
	) => Promise<ChatSendResult | null>;
	/** Add a user course-correction to the active turn. `steer` folds into the next model-loop call; `queue` is
	 *  reserved for SDK parity and currently reports unavailable rather than silently starting a second turn. */
	steerTurn: (input: {
		sessionId: string;
		message: string;
		delivery?: ChatTurnDeliveryMode;
	}) => Promise<ChatSteerTurnResult>;
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
	// F2.7b: sent images live out-of-band from the transcript (own subdir) so the lean-window read stays lean.
	const imageOptions = rootDir ? { rootDir: join(rootDir, "images") } : {};
	const estimateTokens = options.estimateTokens ?? ((text: string) => Math.ceil(text.length / 4));

	interface ActiveChatTurn {
		accept: (message: ChatSteeringMessage) => boolean;
		poll: () => Promise<ChatSteeringMessage[]>;
		close: () => void;
		isOpen: () => boolean;
	}

	const activeChatTurns = new Map<string, ActiveChatTurn>();
	function createActiveChatTurn(): ActiveChatTurn {
		let open = true;
		const pending: ChatSteeringMessage[] = [];
		return {
			accept: (message) => {
				if (!open) {
					return false;
				}
				pending.push(message);
				return true;
			},
			poll: async () => {
				if (pending.length === 0) {
					return [];
				}
				return pending.splice(0, pending.length);
			},
			close: () => {
				open = false;
			},
			isOpen: () => open,
		};
	}

	/**
	 * §5.M short→long memory WRITE: when a turn rolled its overflow into a `summary`, extract the durable facts from it
	 * and persist the genuinely-new ones (recall reads them on later turns). OFF by default behind NKLEIN_CHAT_MEMORY_WRITE
	 * (the extractor's output quality is model-dependent, so it's opt-in until validated per model). Fully best-effort —
	 * a failed extraction/persist never touches the turn's result. Covers BOTH turn paths (tool-using + plain).
	 */
	const maybeConsolidateSessionMemories = async (
		sessionId: string,
		summary: string | null,
		modelDeps: ChatModelDeps,
	): Promise<void> => {
		if (!summary || !modelDeps.extractMemories || process.env.NKLEIN_CHAT_MEMORY_WRITE !== "1") {
			return;
		}
		try {
			const existingMemories = await readChatMemories(memoryOptions);
			await writeConsolidatedMemories(
				{ sessionId, summary, existingMemories },
				{
					extract: modelDeps.extractMemories,
					persist: async (memory) => {
						await appendChatMemory({ sessionId, text: memory.text, embedding: memory.embedding }, memoryOptions);
					},
				},
			);
		} catch {
			// Best-effort — memory consolidation must never break or delay a chat turn.
		}
	};

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

	/**
	 * W3.1: wrap the injected tool executor so every tool call ALSO (a) emits a live start/end activity event for
	 * the composer and (b) persists a `role:"tool"` transcript row (the shared renderer's expandable block).
	 * Persisting is best-effort — a transcript-write failure never breaks the tool call it records.
	 */
	function withToolTranscript(
		agentToolDeps: ChatAgentToolDeps,
		sessionId: string,
		onToolEvent?: (event: ChatToolActivityEvent) => void,
	): ChatAgentToolDeps {
		return {
			...agentToolDeps,
			executeTool: async (call) => {
				onToolEvent?.({ phase: "start", toolName: call.name });
				try {
					const result = await agentToolDeps.executeTool(call);
					await appendChatMessage(
						sessionId,
						{
							role: "tool",
							content: renderToolTranscriptContent(call, result.content),
							meta: { toolName: call.name },
						},
						transcriptOptions,
					).catch(() => undefined);
					return result;
				} finally {
					onToolEvent?.({ phase: "end", toolName: call.name });
				}
			},
		};
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
					...(input.sandboxWritablePaths !== undefined
						? { sandboxWritablePaths: input.sandboxWritablePaths }
						: {}),
					...(input.feedbackMuted !== undefined ? { feedbackMuted: input.feedbackMuted } : {}),
					...(input.feedbackVerbosity !== undefined ? { feedbackVerbosity: input.feedbackVerbosity } : {}),
					...(input.feedbackQuiet !== undefined ? { feedbackQuiet: input.feedbackQuiet } : {}),
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
					...(input.sandboxWritablePaths !== undefined
						? { sandboxWritablePaths: input.sandboxWritablePaths }
						: {}),
					...(input.feedbackMuted !== undefined ? { feedbackMuted: input.feedbackMuted } : {}),
					...(input.feedbackVerbosity !== undefined ? { feedbackVerbosity: input.feedbackVerbosity } : {}),
					...(input.feedbackQuiet !== undefined ? { feedbackQuiet: input.feedbackQuiet } : {}),
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
		getMessageImages: (sessionId, messageId) => readChatMessageImages(sessionId, messageId, imageOptions),
		sendMessage: (input, onToken, onToolEvent) =>
			serializeSessionTurn(input.sessionId, async () => {
				const activeTurn = createActiveChatTurn();
				activeChatTurns.set(input.sessionId, activeTurn);
				try {
					if (!options.resolveModelDeps) {
						throw new Error("This chat service is read-only: no model is configured for sending messages.");
					}
					const session = await getChatSession(input.sessionId, sessionOptions);
					if (!session) {
						return null;
					}
					const modelDeps = await options.resolveModelDeps();
					const tokenBudget = input.tokenBudget ?? resolveChatTokenBudget(options.resolveContextWindowTokens?.());
					const memoryLimit = input.memoryLimit ?? DEFAULT_CHAT_MEMORY_LIMIT;
					// §5.AC: resolve the "knows today" switch per turn (config || env, off by default) so a live config change
					// applies immediately; undefined ⇒ the renderer's env fallback decides. Threaded into the turn deps below.
					const knowsTodayEnabled = options.resolveKnowsTodayEnabled?.();
					const storeDeps = {
						readTranscript: (sessionId: string) => readChatTranscript(sessionId, transcriptOptions),
						readMemories: () => readChatMemories(memoryOptions),
						appendMessage: (
							sessionId: string,
							message: { role: ChatMessage["role"]; content: string; meta?: ChatMessage["meta"] },
						) => appendChatMessage(sessionId, message, transcriptOptions),
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
								// §5.AU item 9 — deterministic relay: a message addressed to a CARD (or an `answer` to a card's
								// question) is RELAYED straight to that card + confirmed, NOT re-answered by a model turn. The
								// runtime's relay decides the effect (deliver live / queue mailbox / suggest-unblock / answer from
								// state) and returns the confirmation; null ⇒ fall through to the model turn (goal/stream/clarify).
								if (options.relayAddressedMessage) {
									const confirmation = await options.relayAddressedMessage(target, input.message);
									if (confirmation !== null) {
										const userMsg = await appendChatMessage(
											session.id,
											{ role: "user", content: input.message },
											transcriptOptions,
										);
										const assistantMsg = await appendChatMessage(
											session.id,
											{ role: "assistant", content: confirmation },
											transcriptOptions,
										);
										return {
											userMessage: toRuntimeChatMessage(userMsg),
											assistantMessage: toRuntimeChatMessage(assistantMsg),
											...(targetLabel ? { targetLabel } : {}),
										};
									}
								}
								// §5.AU item 9 / F2.16b rung 5 — needs_clarify: addressing was ambiguous (>1 slug/ASK match).
								if (target.kind === "needs_clarify" && target.candidates && target.candidates.length > 0) {
									const candidates = target.candidates;
									// F2.16b rung 5: before bothering the operator, run an ISOLATED disambiguation turn — no tools,
									// board, or history, just the message + the enumerated candidates. It picks exactly one candidate's
									// id or ABSTAINs (parseTargetPickerChoice is STRICT — an unknown/hallucinated id also abstains), so
									// it can never invent a route. A confident pick routes exactly like an explicit @handle (via the
									// relay); ABSTAIN / no relay / relay-declined falls through to the operator's clarify picker below.
									if (options.relayAddressedMessage) {
										const picker = buildTargetPickerPrompt({
											message: input.message,
											candidates: candidates.map((candidate) => ({
												id: candidate.id,
												kind: candidate.kind,
												label: candidate.label,
											})),
										});
										const rawChoice = await modelDeps
											.complete([
												{ role: "system", content: picker.system },
												{ role: "user", content: picker.user },
											])
											.catch(() => null);
										const choice =
											rawChoice === null
												? { abstain: true as const }
												: parseTargetPickerChoice(
														rawChoice,
														candidates.map((candidate) => candidate.id),
													);
										if ("chosenId" in choice) {
											const picked = candidates.find((candidate) => candidate.id === choice.chosenId);
											if (picked) {
												const confirmation = await options.relayAddressedMessage(
													resolveTargetFromCandidate(picked),
													input.message,
												);
												if (confirmation !== null) {
													const userMsg = await appendChatMessage(
														session.id,
														{ role: "user", content: input.message },
														transcriptOptions,
													);
													const assistantMsg = await appendChatMessage(
														session.id,
														{ role: "assistant", content: confirmation },
														transcriptOptions,
													);
													return {
														userMessage: toRuntimeChatMessage(userMsg),
														assistantMessage: toRuntimeChatMessage(assistantMsg),
														targetLabel: picked.label,
													};
												}
											}
										}
									}
									// ABSTAIN / no relay / relay-declined: surface the candidates for the composer's picker instead of
									// guessing — post a deterministic clarify prompt + return the candidates. The user picks one (inserts
									// its @handle) and re-sends. No further model turn.
									const clarifyCandidates: RuntimeChatClarifyCandidate[] = candidates.map((candidate) => ({
										kind: candidate.kind,
										id: candidate.id,
										label: candidate.label,
									}));
									const options_ = clarifyCandidates.map((candidate) => `"${candidate.label}"`).join(", ");
									const userMsg = await appendChatMessage(
										session.id,
										{ role: "user", content: input.message },
										transcriptOptions,
									);
									const assistantMsg = await appendChatMessage(
										session.id,
										{
											role: "assistant",
											content: `Your message could address more than one target (${options_}). Which did you mean? Pick one below, or rephrase with an @handle.`,
										},
										transcriptOptions,
									);
									return {
										userMessage: toRuntimeChatMessage(userMsg),
										assistantMessage: toRuntimeChatMessage(assistantMsg),
										clarifyCandidates,
									};
								}
							}
						}
						const turnStartedAt = Date.now();
						// F2.19b/F2.20b: a klein_self session leads its turn with a corpus grounding note (routed docs +
						// real freshness citations) so the answer reads CURRENT source instead of remembered prose.
						const kleinSelfCorpusNote =
							session.scope === "klein_self" && options.buildKleinSelfCorpusNote
								? await options.buildKleinSelfCorpusNote(session, input.message).catch(() => null)
								: null;
						// F2.7b: resolve the selected model's vision capability at the send seam (fail-closed to [] — a model
						// not known vision-capable refuses images rather than sending bytes it can't read).
						const modelCapabilityIds =
							modelDeps.modelId && options.resolveModelCapabilityIds
								? await options.resolveModelCapabilityIds(modelDeps.modelId)
								: [];
						const agentResult = await runChatAgentTurn(
							{
								session,
								userMessage: input.message,
								tokenBudget,
								memoryLimit,
								...(typeof agentToolDeps.maxIterations === "number"
									? { maxIterations: agentToolDeps.maxIterations }
									: {}),
								...(onToken ? { onToken } : {}),
								...(targetNote ? { targetNote } : {}),
								...(kleinSelfCorpusNote ? { kleinSelfCorpusNote } : {}),
								...(input.imageAttachments && input.imageAttachments.length > 0
									? { imageAttachments: input.imageAttachments }
									: {}),
								...(modelCapabilityIds.length > 0 ? { modelCapabilityIds } : {}),
							},
							{
								...storeDeps,
								summarize: modelDeps.summarize,
								// F2.7b: persist the sent images out-of-band, keyed by the user message id, for history rendering.
								persistImageAttachments: (messageId, images) =>
									writeChatMessageImages(session.id, messageId, images, imageOptions),
								...withToolTranscript(agentToolDeps, session.id, onToolEvent),
								pollSteeringMessages: activeTurn.poll,
								closeSteering: activeTurn.close,
								// §5.AD opt-in enforced-reasoning bounce over the final draft (flag-gated inside; fail-soft).
								enforceReasoning: ({ task, draft }) =>
									maybeEnforceReasoning({
										task,
										draft,
										...(modelDeps.modelId !== undefined ? { modelId: modelDeps.modelId } : {}),
										complete: async ({ system, user }) =>
											modelDeps.complete([
												...(system ? [{ role: "system" as const, content: system }] : []),
												{ role: "user" as const, content: user },
											]),
									}),
							},
						);
						// §5.AF: best-effort append a `chat`-flow attempt event to the ledger (observational; never throws into
						// the turn — the sink swallows its own errors). Only when the model id is known.
						if (options.recordChatAttempt && modelDeps.modelId) {
							options.recordChatAttempt({
								sessionId: session.id,
								modelId: modelDeps.modelId,
								toolNames: agentResult.steps.map((step) => step.toolCall.name),
								hitIterationLimit: agentResult.hitIterationLimit,
								promptStrategy: agentResult.promptStrategies.at(-1) ?? null,
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
						// §5.M: consolidate this turn's rolled-up summary into durable long-term memory (best-effort, flag-gated).
						await maybeConsolidateSessionMemories(session.id, agentResult.context.summary, modelDeps);
						// F2.7b: a refused attachment (non-vision model / over-budget) surfaces alongside any model-gate notice.
						const combinedNotice = agentResult.attachmentNotice
							? capabilityNotice
								? `${capabilityNotice}\n${agentResult.attachmentNotice}`
								: agentResult.attachmentNotice
							: capabilityNotice;
						return {
							userMessage: toRuntimeChatMessage(agentResult.userMessage),
							assistantMessage: toRuntimeChatMessage(agentResult.assistantMessage),
							...(combinedNotice ? { capabilityNotice: combinedNotice } : {}),
							...(targetLabel ? { targetLabel } : {}),
							// W3.4 truncation indicator: the lean window rolled older messages into a summary this turn.
							...(agentResult.context.summary !== null ? { contextTruncated: true } : {}),
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
						{
							...storeDeps,
							...modelDeps,
							pollSteeringMessages: activeTurn.poll,
							closeSteering: activeTurn.close,
						},
					);
					// §5.M: same best-effort memory consolidation for the plain (non-tool) turn path.
					await maybeConsolidateSessionMemories(session.id, result.context.summary, modelDeps);
					return {
						userMessage: toRuntimeChatMessage(result.userMessage),
						assistantMessage: toRuntimeChatMessage(result.assistantMessage),
					};
				} finally {
					activeTurn.close();
					if (activeChatTurns.get(input.sessionId) === activeTurn) {
						activeChatTurns.delete(input.sessionId);
					}
				}
			}),
		steerTurn: async (input) => {
			const delivery: ChatTurnDeliveryMode = input.delivery ?? "steer";
			const normalized = input.message.trim();
			if (normalized.length === 0) {
				return { ok: false, delivery, message: null, error: "Steering message cannot be empty." };
			}
			if (delivery === "queue") {
				return {
					ok: false,
					delivery,
					message: null,
					error: "Queued follow-up delivery is not implemented for unified chat turns yet.",
				};
			}
			const activeTurn = activeChatTurns.get(input.sessionId);
			if (!activeTurn?.isOpen()) {
				return {
					ok: false,
					delivery,
					message: null,
					error: "No active chat turn is accepting steering.",
				};
			}
			const session = await getChatSession(input.sessionId, sessionOptions);
			if (!session) {
				return { ok: false, delivery, message: null, error: "Chat session does not exist." };
			}
			const steeringMessage: ChatSteeringMessage = {
				id: randomUUID(),
				content: normalized,
				createdAt: (now ?? Date.now)(),
			};
			if (!activeTurn.accept(steeringMessage)) {
				return {
					ok: false,
					delivery,
					message: null,
					error: "The active chat turn is already producing its final reply.",
				};
			}
			const persisted = await appendChatMessage(
				input.sessionId,
				{
					id: steeringMessage.id,
					role: "user",
					content: steeringMessage.content,
					createdAt: steeringMessage.createdAt,
				},
				transcriptOptions,
			);
			return { ok: true, delivery, message: toRuntimeChatMessage(persisted) };
		},
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
				const tokenBudget = resolveChatTokenBudget(options.resolveContextWindowTokens?.());
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
						const turnMaxIterations =
							typeof maxIterations === "number" && typeof agentToolDeps.maxIterations === "number"
								? Math.min(maxIterations, agentToolDeps.maxIterations)
								: (maxIterations ?? agentToolDeps.maxIterations);
						const turn = await runChatAgentTurn(
							{
								session,
								userMessage,
								tokenBudget,
								memoryLimit,
								...(typeof turnMaxIterations === "number" ? { maxIterations: turnMaxIterations } : {}),
							},
							{
								...storeDeps,
								summarize: modelDeps.summarize,
								...withToolTranscript(agentToolDeps, session.id),
							},
						);
						// §5.AF: best-effort `autonomous`-flow ledger attempt per autonomous turn (observational; never throws).
						if (options.recordChatAttempt && modelDeps.modelId) {
							options.recordChatAttempt({
								sessionId: session.id,
								modelId: modelDeps.modelId,
								toolNames: turn.steps.map((step) => step.toolCall.name),
								hitIterationLimit: turn.hitIterationLimit,
								promptStrategy: turn.promptStrategies.at(-1) ?? null,
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
						// §5.M: consolidate each autonomous turn's rolled-up summary into durable memory (best-effort, flag-gated).
						await maybeConsolidateSessionMemories(session.id, turn.context.summary, modelDeps);
						return { finalText: turn.assistantMessage.content, steps: turn.steps };
					},
					readPlanProgress: () => readAutonomousChatPlanProgress(session.id),
					budget: input.budget,
					...(input.maxIterationsPerTurn ? { maxIterationsPerTurn: input.maxIterationsPerTurn } : {}),
				});
			}),
	};
}

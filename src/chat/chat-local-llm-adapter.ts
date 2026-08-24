import { answerBudgetPrior } from "../core/answer-budget-prior";
import { deriveTruncationSignal } from "../core/completion-stop-reason";
import { extractCompletionUsage } from "../core/completion-usage";
import { isTruthyEnv, resolveDefaultOnFlag } from "../core/env-flag";
import {
	applyThinkingDisable,
	getThinkingRequestControl,
	isReasoningModel,
	supportsThinkingControl,
} from "../core/model-thinking-control";
import { downgradeSchemaForProfile } from "../core/provider-schema-downgrade";
import { schemaProviderFromProviderId, selectProviderSchemaProfile } from "../core/provider-schema-profile";
import { createReasoningBudgetTracker, REASONING_BUDGET_BREACH_NUDGE } from "../core/reasoning-budget-breach";
import { stripReasoningChannel } from "../core/reasoning-channel-split";
import { planReasoningOutputBudget } from "../core/reasoning-output-budget";
import { createRetryStrategyCursor, type RetryStrategy, raisedTokenBudget } from "../core/retry-policy";
import { resolveApiProfileRequest } from "../core/skill-api-profile-request";
import { modulateApiProfileForDifficulty, type SkillApiProfile } from "../core/skill-registry";
import { buildTruncationObservation } from "../core/truncation-diagnostics-summary";
import { MAX_ATTEMPT_SIMPLIFICATION_LEVEL, selectToolsForAttempt } from "../nklein-agent/nklein-attempt-simplification";
import { buildConstrainedToolCallSchema, parseConstrainedToolCall } from "../nklein-agent/nklein-constrained-tool-call";
import type {
	LocalLlmChatMessage,
	LocalLlmCompletion,
	LocalLlmSamplingOptions,
	LocalLlmStructuredFormat,
	LocalLlmToolCompletion,
	LocalLlmToolDefinition,
} from "../nklein-agent/nklein-local-llm-client";
import {
	buildPromptVariant,
	PROMPT_VARIANT_LADDER,
	type PromptVariantFamily,
} from "../nklein-agent/nklein-prompt-variation";
import { detectResponseLoop } from "../nklein-agent/nklein-response-loop-detection";
import { appendTruncationObservations } from "../state/truncation-observation-store";
import { recordSelfObservation } from "../telemetry/self-observation-sink";
import type { ChatAgentModelResponse, ChatToolResult } from "./chat-agent-loop";
import type { ChatMessage } from "./chat-transcript-store";
import type { ChatPromptMessage } from "./chat-turn-context";

/**
 * Adapter wiring the chat runtime (todo §5.M) to a local LLM client ([nklein-local-llm-client.ts]
 * (../nklein-agent/nklein-local-llm-client.ts), which is fail-closed against cloud per invariant #1). It provides
 * the `complete` + `summarize` deps `runChatTurn` needs, mapping the rendered chat prompt to the client's
 * OpenAI-compatible messages and stripping any `<think>…</think>` a reasoning model leaves inline (observed live
 * with qwen3). The client is an interface so this is unit-testable with a fake; the live wiring passes a real
 * `LocalLlmClient` whose model is discovered from the loaded endpoint.
 */

export interface ChatCompletionClient {
	complete(request: {
		messages: LocalLlmChatMessage[];
		sampling?: LocalLlmSamplingOptions;
	}): Promise<LocalLlmCompletion>;
	/** Optional streaming variant; when present and an `onToken` is given, the reply is streamed. */
	completeStream?(
		request: { messages: LocalLlmChatMessage[]; sampling?: LocalLlmSamplingOptions },
		onChunk: (delta: string) => void,
		opts?: { onReasoningDelta?: (delta: string) => boolean },
	): Promise<LocalLlmCompletion>;
}

export interface ChatModelDeps {
	/** Completes the prompt; when `onToken` is given and the client streams, tokens arrive incrementally. */
	complete: (prompt: ChatPromptMessage[], onToken?: (delta: string) => void) => Promise<string>;
	summarize: (overflow: readonly ChatMessage[]) => Promise<string>;
	/** §5.M memory WRITE: extract 0-5 durable long-term facts from a rolling session summary (a model call).
	 *  Optional so lightweight/test deps stay valid; the live `createChatModelDeps` always supplies it. */
	extractMemories?: (summary: string) => Promise<string[]>;
	/** The resolved model id (§5.AL) — lets the chat service apply the capability gate when tools are in play. */
	modelId?: string;
	/**
	 * F3.13 cross-model carry: resolve a STRONGER loaded peer (distinct model, higher unambiguous parameter
	 * count) and a completion bound to it. Null when no stronger peer is loaded — the enforced-reasoning loop
	 * then degrades to keeping the draft, exactly as before.
	 */
	resolveStrongerPeer?: (draftModelId: string) => Promise<{
		modelId: string;
		complete: (input: { system?: string; user: string }) => Promise<string>;
	} | null>;
}

/** §5.M the extractor system prompt — pull DURABLE facts a future session should know, not transient chatter. */
const MEMORY_EXTRACTION_PROMPT =
	"From the conversation summary below, extract the DURABLE facts worth remembering in future sessions: decisions " +
	"made, stable user preferences, and project facts. Ignore transient chit-chat, questions, and anything already " +
	"obvious. Reply with ONE fact per line, terse (no bullets, no numbering, no preamble). If nothing is worth " +
	"remembering, reply with an empty response.";

/** Max memories extracted per summary — a durable-fact list should be short; caps a runaway extractor. */
const MAX_EXTRACTED_MEMORIES = 5;

/**
 * Parse the extractor model's reply into clean memory lines (§5.M): split on newlines, strip common list markup
 * (bullets `-`/`*`/`•`, `1.`/`1)` numbering, surrounding quotes), drop blanks and a "nothing to remember" sentinel,
 * and cap the count. Pure + exported for tests — model output is messy, so the normalization is the interesting part.
 */
export function parseExtractedMemories(raw: string): string[] {
	const out: string[] = [];
	for (const line of raw.split(/\r?\n/)) {
		let text = line.trim();
		if (text.length === 0) {
			continue;
		}
		text = text
			.replace(/^[-*•]\s+/, "") // bullet
			.replace(/^\d+[.)]\s+/, "") // "1." / "1)"
			.replace(/^["'`]|["'`]$/g, "") // surrounding quotes
			.trim();
		if (text.length === 0) {
			continue;
		}
		// A model with nothing to remember often still emits a sentence; drop the common "none" phrasings.
		if (/^(none|nothing( to remember)?|no durable facts|n\/a)\.?$/i.test(text)) {
			continue;
		}
		out.push(text);
		if (out.length >= MAX_EXTRACTED_MEMORIES) {
			break;
		}
	}
	return out;
}

/**
 * Strip inline `<think>…</think>` reasoning a model may leave in its content — via the §5.AN truncation-safe
 * `stripReasoningChannel` core. FIXES a latent leak: the old inline regex required the closing `</think>`, so a
 * truncated/unclosed `<think>` (a reasoning model cut off mid-thought — the §5.AA truncation case) leaked the ENTIRE
 * reasoning dump into the user-visible answer. The core treats an unterminated open marker as reasoning-to-end; a
 * well-formed `<think>…</think>` block strips identically (both trim).
 */
function stripReasoning(content: string): string {
	return stripReasoningChannel(content);
}

/**
 * Clean a raw model reply: strip inline reasoning, then collapse any runaway repeated-tail loop to its useful prefix
 * (§5.AA salvage — grounded in the §5.Z sweep where a model looped an identical final sentence). `detectResponseLoop`
 * returns the text unchanged when there's no loop, so this is always safe to apply.
 */
function cleanModelReply(content: string): string {
	return detectResponseLoop(stripReasoning(content)).salvagedText;
}

const DEFAULT_SAMPLING: LocalLlmSamplingOptions = { temperature: 0.3, maxTokens: 1024 };
// §5.AA: the ceiling for the escalating truncation-retry budget — a generous reasoning headroom that stays well within a
// typical local context window so the retry can't overshoot it.
const TRUNCATION_RETRY_BUDGET_CEILING = 8192;
// §5.AA OPT-IN (default OFF): when set, the truncation rung keeps raising the budget across up to
// TRUNCATION_RETRY_MAX_ATTEMPTS escalations (toward the ceiling) instead of the single one-shot escalation. Flag OFF ⇒
// exactly one escalation ⇒ byte-identical to the prior behavior. For big reasoners that need the full headroom (live: the
// 27B truncated at 1024 and climbed across escalations) — a persistently-truncating model is still bounded by BOTH the
// attempt count AND the ceiling clamp (raisedTokenBudget stops growing), so the turn can never spin.
const ADAPTIVE_TRUNCATION_LADDER_FLAG = "NKLEIN_CHAT_ADAPTIVE_TRUNCATION";
/**
 * F3.36 (adopted from little-coder; docs/attributions.md) OPT-IN, default OFF = byte-identical: watch the
 * streamed reasoning channel and, the moment its spend breaches the per-turn budget, stop the stream, disable
 * thinking (the model's verified soft switch), and retry ONCE with a commit-now nudge — the mid-turn complement
 * to the post-turn §5.AA rungs. Applies only to reasoning models with a verified thinking control.
 */
/** The visible seam when a breach retry replaces the turn (same UX contract as the continuation marker). */
export const REASONING_BREACH_MARKER = "\n\n_(reasoning budget exceeded — retrying with thinking off)_\n\n";
const TRUNCATION_RETRY_MAX_ATTEMPTS = 3;

/**
 * §5.AN pre-flight budget sizing — when enabled AND the resolved model is a reasoning model AND the caller did not
 * pass an explicit `sampling.maxTokens`, size the chat-turn `max_tokens` with a reasoning reserve on top of the
 * default answer budget (via the pure {@link planReasoningOutputBudget} core) so a reasoning model's answer isn't
 * starved by its own thinking burn. Default (OFF) is byte-identical to today — the DEFAULT_SAMPLING is used unchanged.
 * Enabled by the `reasoningBudgetEnabled` runtime setting OR this env override (§5.BB).
 */
const REASONING_BUDGET_FLAG = "NKLEIN_REASONING_BUDGET";

/**
 * §5.BB runtime-config bits for the two chat-adapter feature gates, updatable at the runtime-server config-apply seam
 * via {@link setChatAdapterRuntimeFlags}. The adapter is constructed deep below the config plumbing (per-turn client
 * factories), so a module-level bit the server refreshes on every config load/save is the honest seam. Env overrides
 * still compose at READ time: `NKLEIN_CHAT_ADAPTIVE_TRUNCATION` is a two-way escape hatch over its default-ON setting
 * (explicit `0` force-disables, truthy force-enables), and `NKLEIN_REASONING_BUDGET` ORs into its default-OFF setting.
 * The defaults here mirror runtime-config-defaults so a process that never applies a config (tests, harness scripts)
 * behaves byte-identically to the pre-§5.BB env-only world.
 */
interface ChatAdapterRuntimeFlags {
	adaptiveTruncationEnabled: boolean;
	reasoningBudgetEnabled: boolean;
}

let chatAdapterRuntimeFlags: ChatAdapterRuntimeFlags = {
	adaptiveTruncationEnabled: true,
	reasoningBudgetEnabled: false,
};

/** Apply the persisted chat-adapter settings (called from the runtime server whenever the runtime config is (re)applied). */
export function setChatAdapterRuntimeFlags(flags: ChatAdapterRuntimeFlags): void {
	chatAdapterRuntimeFlags = { ...flags };
}

/** The effective §5.AA adaptive-truncation gate: config bit unless the env escape hatch is explicitly set. */
function isAdaptiveTruncationLadderEnabled(): boolean {
	return resolveDefaultOnFlag(
		chatAdapterRuntimeFlags.adaptiveTruncationEnabled,
		process.env[ADAPTIVE_TRUNCATION_LADDER_FLAG],
	);
}

/** The effective §5.AN reasoning-budget gate: config bit OR the env override (either enables). */
function isReasoningBudgetEnabled(): boolean {
	return chatAdapterRuntimeFlags.reasoningBudgetEnabled || isTruthyEnv(process.env[REASONING_BUDGET_FLAG]);
}

/**
 * Resolve the sampling options for the chat-turn path. DEFAULT (flag OFF / non-reasoning model / caller-supplied
 * `maxTokens`) is byte-identical to `options.sampling ?? DEFAULT_SAMPLING` — this is the hottest live path, so the
 * un-opted behaviour must not change. When {@link REASONING_BUDGET_FLAG} is truthy and the model reasons AND the caller
 * did NOT already fix `maxTokens`, replace ONLY `maxTokens` with the reasoning-reserve total (the answer budget is the
 * DEFAULT_SAMPLING answer budget), leaving every other sampling field untouched.
 */
/** The resolved sampling PLUS the reasoning/answer budget split it used (for F4.12 truncation diagnostics). */
interface ResolvedChatTurnSampling {
	sampling: LocalLlmSamplingOptions;
	/** Tokens reserved for the reasoning channel (0 when the reasoning budget wasn't applied). */
	reasoningBudget: number;
	/** Tokens protected for the answer. */
	answerBudget: number;
}

function resolveChatTurnSampling(options: {
	sampling?: LocalLlmSamplingOptions;
	modelId?: string;
}): ResolvedChatTurnSampling {
	const base = options.sampling ?? DEFAULT_SAMPLING;
	const answerBudgetTokens = base.maxTokens ?? DEFAULT_SAMPLING.maxTokens ?? 1024;
	// Only opt-in when the flag is ON, a modelId is known + reasons, and the caller did NOT pass an explicit
	// `sampling.maxTokens` (an explicit caller budget always wins — we never inflate what the caller pinned). Any miss ⇒
	// return `base` unchanged (byte-identical default); the whole budget is then the answer budget (no reasoning reserve).
	if (
		options.sampling?.maxTokens !== undefined ||
		!isReasoningBudgetEnabled() ||
		!options.modelId ||
		!isReasoningModel(options.modelId)
	) {
		return { sampling: base, reasoningBudget: 0, answerBudget: answerBudgetTokens };
	}
	// `base` is DEFAULT_SAMPLING here (caller passed no sampling, or sampling without maxTokens); size ONLY maxTokens off
	// the default answer budget, preserving every other field.
	const budget = planReasoningOutputBudget({ answerBudgetTokens, isReasoning: true });
	return {
		sampling: { ...base, maxTokens: budget.totalMaxTokens },
		reasoningBudget: budget.reasoningReserveTokens,
		answerBudget: budget.answerBudgetTokens,
	};
}

/**
 * §5.AA plain-completion truncation ladder (opt-in via the same NKLEIN_CHAT_ADAPTIVE_TRUNCATION flag as the tool path).
 * A plain (non-tool) completion that hit `finish:"length"` leaves the user a half-sentence answer or a summary that
 * dropped context — but UNLIKE the tool path, the plain path had NO retry at all. When the flag is on, re-ask with a
 * compounding larger budget (bounded by BOTH the pass count AND the ceiling clamp, so it can't spin) and return the
 * fuller reply. Default OFF ⇒ a single completion, byte-identical to before.
 *
 * NON-STREAMING only: a streamed turn already showed the caller live deltas, so re-streaming a retry would double the
 * visible output — that path is intentionally left untouched (its UX contract is the caller's to decide).
 */
async function completePlainWithTruncationLadder(
	client: ChatCompletionClient,
	messages: LocalLlmChatMessage[],
	sampling: LocalLlmSamplingOptions,
	// F4.12 — invoked with the FINAL completion (after any escalation) so the caller can record a truncation observation.
	onFinalCompletion?: (completion: LocalLlmCompletion) => void,
): Promise<string> {
	let completion = await client.complete({ messages, sampling });
	if (isAdaptiveTruncationLadderEnabled()) {
		let budget = sampling.maxTokens ?? DEFAULT_SAMPLING.maxTokens ?? 1024;
		for (let pass = 0; pass < TRUNCATION_RETRY_MAX_ATTEMPTS; pass += 1) {
			if (!deriveTruncationSignal({ rawReason: completion.finishReason, tokenBudget: budget }).shouldRetryLarger) {
				break;
			}
			const escalated = raisedTokenBudget({ current: budget, attempt: 1, ceiling: TRUNCATION_RETRY_BUDGET_CEILING });
			if (escalated <= budget) {
				break;
			}
			completion = await client.complete({ messages, sampling: { ...sampling, maxTokens: escalated } });
			budget = escalated;
		}
	}
	onFinalCompletion?.(completion);
	return cleanModelReply(completion.content);
}

/** The visible-but-subtle seam between a cut-off streamed reply and its continuation (§10c#12, user 2026-07-12). */
export const STREAM_CONTINUATION_MARKER = "\n\n_(continued)_\n\n";
const STREAM_CONTINUE_NUDGE =
	"Your previous reply was cut off by the token limit. Continue EXACTLY where you stopped — do not repeat " +
	"anything you already wrote and do not summarize; just continue the reply.";

/**
 * §5.AA streamed-turn truncation — UX contract decided 2026-07-12 (§10c#12): APPEND-CONTINUATION. When a token-
 * streamed chat turn ends `finish:"length"`, ask the model to CONTINUE from where it stopped and stream the
 * continuation after a subtle "(continued)" marker — never re-stream/replace what the user already saw. Bounded by
 * the same pass count + budget ceiling as the plain ladder; gated on the same adaptive-truncation switch (default
 * ON via config; a disabled switch keeps the old single-stream behavior byte-identical).
 */
async function streamWithContinuationLadder(
	client: ChatCompletionClient,
	messages: LocalLlmChatMessage[],
	sampling: LocalLlmSamplingOptions,
	onToken: (delta: string) => void,
	onFinalCompletion?: (completion: LocalLlmCompletion) => void,
	breachModelId?: string,
): Promise<string> {
	if (!client.completeStream) {
		return completePlainWithTruncationLadder(client, messages, sampling, onFinalCompletion);
	}
	// Bind, don't detach: the production client is a class instance whose completeStream reads `this.config` — the
	// detached call broke EVERY streamed chat turn ("Cannot read properties of undefined (reading 'config')") while
	// the plain-object test fakes kept passing. Keep the receiver.
	const completeStream = client.completeStream.bind(client);
	// F3.36 mid-turn reasoning-budget breach: only for reasoning models with a VERIFIED thinking soft switch —
	// forcing thinking off on a model without one would silently do nothing and waste the retry.
	const breachEligible =
		isTruthyEnv(process.env.NKLEIN_REASONING_BREACH) &&
		breachModelId !== undefined &&
		isReasoningModel(breachModelId) &&
		(supportsThinkingControl(breachModelId) || getThinkingRequestControl(breachModelId) !== null);
	const tracker = breachEligible ? createReasoningBudgetTracker() : null;
	let first = await completeStream(
		{ messages, sampling },
		onToken,
		tracker ? { onReasoningDelta: (delta) => tracker.addReasoningDelta(delta.length) } : undefined,
	);
	if (tracker?.breached() && breachModelId) {
		// Visibility first (David 2026-07-23): the operator sees the breach the moment it acts, in the stream.
		onToken(REASONING_BREACH_MARKER);
		try {
			recordSelfObservation({
				signal: "custom",
				severity: "info",
				message: `Reasoning budget breached mid-stream on ${breachModelId} (~${tracker.spentTokens()} reasoning tokens) — retrying with thinking off.`,
				metadata: {
					category: "reasoning_budget_breach",
					modelId: breachModelId,
					spentTokens: tracker.spentTokens(),
				},
			});
		} catch {
			// Telemetry must never break the turn.
		}
		const breachRequestControl = getThinkingRequestControl(breachModelId);
		const disabledMessages = replaceLastUserText(
			messages,
			`${applyThinkingDisable(lastUserText(messages), breachModelId)}\n\n${REASONING_BUDGET_BREACH_NUDGE}`,
		);
		// Param-switch models (qwen3.8 line): thinking off rides the REQUEST (`reasoning_effort:"none"`) — the
		// message token is a live-probed no-op there, so applyThinkingDisable already left the text alone.
		const breachSampling = breachRequestControl
			? { ...sampling, reasoningEffort: breachRequestControl.disableValue }
			: sampling;
		first = await completeStream({ messages: disabledMessages, sampling: breachSampling }, onToken);
	}
	let combined = cleanModelReply(first.content);
	let lastCompletion = first;
	if (isAdaptiveTruncationLadderEnabled()) {
		let budget = sampling.maxTokens ?? DEFAULT_SAMPLING.maxTokens ?? 1024;
		for (let pass = 0; pass < TRUNCATION_RETRY_MAX_ATTEMPTS; pass += 1) {
			if (
				!deriveTruncationSignal({ rawReason: lastCompletion.finishReason, tokenBudget: budget }).shouldRetryLarger
			) {
				break;
			}
			const escalated = raisedTokenBudget({ current: budget, attempt: 1, ceiling: TRUNCATION_RETRY_BUDGET_CEILING });
			if (escalated <= budget) {
				break;
			}
			onToken(STREAM_CONTINUATION_MARKER);
			const continuation = await completeStream(
				{
					messages: [
						...messages,
						{ role: "assistant", content: combined },
						{ role: "user", content: STREAM_CONTINUE_NUDGE },
					],
					sampling: { ...sampling, maxTokens: escalated },
				},
				onToken,
			);
			combined = `${combined}${STREAM_CONTINUATION_MARKER}${cleanModelReply(continuation.content)}`;
			lastCompletion = continuation;
			budget = escalated;
		}
	}
	onFinalCompletion?.(lastCompletion);
	return combined;
}

/**
 * F4.12 — record ONE truncation observation, best-effort + opt-in (NKLEIN_TRUNCATION_DIAGNOSTICS, default OFF = no I/O).
 * Shared by the chat + swarm completion wires. A `reasoningTokensHint`/`totalTokensHint` (which the swarm's tool
 * completion reports directly) wins over the raw-parsed usage. Fire-and-forget: a recording never affects the turn.
 */
function recordTruncationObservation(input: {
	modelId?: string;
	surface: string;
	role: string;
	finishReason: string | null;
	raw: unknown;
	reasoningTokensHint?: number | null;
	totalTokensHint?: number | null;
	reasoningBudget: number;
	answerBudget: number;
	rootDir?: string;
}): void {
	if (!isTruthyEnv(process.env.NKLEIN_TRUNCATION_DIAGNOSTICS)) {
		return;
	}
	try {
		const usage = extractCompletionUsage(input.raw);
		const reasoningTokens = input.reasoningTokensHint ?? usage.reasoningTokens ?? 0;
		const answerTokens =
			usage.answerTokens ??
			(input.totalTokensHint != null
				? Math.max(0, input.totalTokensHint - reasoningTokens)
				: (usage.totalCompletionTokens ?? 0));
		const observation = buildTruncationObservation({
			modelId: input.modelId ?? "unknown",
			surface: input.surface,
			role: input.role,
			hitLengthLimit: input.finishReason === "length",
			reasoningTokens,
			answerTokens,
			reasoningBudget: input.reasoningBudget,
			answerBudget: input.answerBudget,
		});
		if (observation) {
			void appendTruncationObservations([observation], input.rootDir ? { rootDir: input.rootDir } : undefined).catch(
				() => {},
			);
		}
	} catch {
		// best-effort telemetry — never throw into a turn
	}
}

export function createChatModelDeps(
	client: ChatCompletionClient,
	options: {
		sampling?: LocalLlmSamplingOptions;
		modelId?: string;
		/** F4.15: selected-skill sampler/thinking policy for the user-visible final answer. */
		apiProfile?: SkillApiProfile;
		/** F4.12 test seam: override the truncation-observation store root (defaults to the runtime home). */
		truncationStoreRootDir?: string;
	} = {},
): ChatModelDeps {
	const apiRequest = resolveApiProfileRequest(options.apiProfile, options.modelId ?? "");
	const profileSampling =
		apiRequest.temperature !== null
			? { ...(options.sampling ?? DEFAULT_SAMPLING), temperature: apiRequest.temperature }
			: options.sampling;
	let { sampling, reasoningBudget, answerBudget } = resolveChatTurnSampling({
		...options,
		...(profileSampling ? { sampling: profileSampling } : {}),
	});
	if (
		options.apiProfile?.reasoning === "high" &&
		options.sampling?.maxTokens === undefined &&
		options.modelId &&
		isReasoningModel(options.modelId)
	) {
		const budget = planReasoningOutputBudget({
			answerBudgetTokens: sampling.maxTokens ?? DEFAULT_SAMPLING.maxTokens ?? 1024,
			isReasoning: true,
		});
		sampling = { ...sampling, maxTokens: budget.totalMaxTokens };
		reasoningBudget = budget.reasoningReserveTokens;
		answerBudget = budget.answerBudgetTokens;
	}
	// F4.12 — record WHY a chat completion truncated (opt-in NKLEIN_TRUNCATION_DIAGNOSTICS, default OFF = no I/O).
	// Best-effort: any failure is swallowed so a recording never affects the chat turn. Fills `dev truncation-diagnostics`.
	const recordTruncation = (surface: string, completion: LocalLlmCompletion): void =>
		recordTruncationObservation({
			modelId: options.modelId,
			surface,
			role: "chat",
			finishReason: completion.finishReason,
			raw: completion.raw,
			reasoningBudget,
			answerBudget,
			rootDir: options.truncationStoreRootDir,
		});
	return {
		...(options.modelId ? { modelId: options.modelId } : {}),
		complete: async (prompt, onToken) => {
			let messages = prompt.map((message) => ({
				role: message.role,
				content: message.content,
				// F2.7b: forward multimodal parts (present only on a vision user turn) to the wire as array content.
				...(message.parts ? { parts: message.parts } : {}),
			}));
			if (apiRequest.thinkingDirective) {
				messages = replaceLastUserText(messages, `${lastUserText(prompt)}\n\n${apiRequest.thinkingDirective}`);
			}
			if (onToken && client.completeStream) {
				// Stream raw deltas to the caller (live view); persist the cleaned (reasoning-stripped + loop-salvaged)
				// reply. A finish:"length" cut-off streams an appended continuation after a subtle marker (§10c#12).
				return streamWithContinuationLadder(
					client,
					messages,
					sampling,
					onToken,
					(c) => recordTruncation("chat-stream", c),
					options.modelId,
				);
			}
			return completePlainWithTruncationLadder(client, messages, sampling, (c) => recordTruncation("chat", c));
		},
		extractMemories: async (summary) => {
			const raw = await completePlainWithTruncationLadder(
				client,
				[
					{ role: "system", content: MEMORY_EXTRACTION_PROMPT },
					{ role: "user", content: summary },
				],
				sampling,
				(c) => recordTruncation("chat-memory", c),
			);
			return parseExtractedMemories(raw);
		},
		summarize: async (overflow) => {
			const transcript = overflow.map((message) => `${message.role}: ${message.content}`).join("\n");
			return completePlainWithTruncationLadder(
				client,
				[
					{
						role: "system",
						content:
							"Summarize the earlier conversation below into a concise note that preserves decisions, facts, and open threads. Reply with only the summary.",
					},
					{ role: "user", content: transcript },
				],
				sampling,
				(c) => recordTruncation("chat-summary", c),
			);
		},
	};
}

export interface ChatAgentCompletionClient {
	completeWithTools(
		request: { messages: LocalLlmChatMessage[]; sampling?: LocalLlmSamplingOptions },
		tools: readonly LocalLlmToolDefinition[],
		/**
		 * Optional §5.AA/§5.AN native-forcing lever: `toolChoice:"required"` FORCES a tool call (the reasoning-safe path
		 * where json_schema dead-ends). Optional ⇒ existing impls satisfy this interface; when omitted the client defaults
		 * to `"auto"` (byte-identical to today).
		 */
		opts?: { toolChoice?: "auto" | "required" },
	): Promise<LocalLlmToolCompletion>;
	/**
	 * Optional plain completion with constrained decoding (`response_format: json_schema`) — the §5.AA
	 * constrained-tool-call rung uses it to FORCE a parseable tool call. `LocalLlmClient.complete` satisfies this; a
	 * client without it simply skips the rung.
	 */
	complete?(request: {
		messages: LocalLlmChatMessage[];
		sampling?: LocalLlmSamplingOptions;
		format?: LocalLlmStructuredFormat;
	}): Promise<{ content: string }>;
}

/**
 * Provides the agent loop's `complete(messages, allowTools)` from a tools-aware local client: it offers the tool
 * definitions only when `allowTools` is set (so the forced final turn can't request more), maps the prompt to the
 * client's messages, and returns the reasoning-stripped text + parsed tool calls.
 */
export function createChatAgentModel(
	client: ChatAgentCompletionClient,
	toolDefinitions: readonly LocalLlmToolDefinition[],
	options: {
		sampling?: LocalLlmSamplingOptions;
		modelId?: string;
		apiProfile?: SkillApiProfile;
		/** §5.AA learned phrasing: the model's known-responsive variant family (from its ModelBehaviorProfile) is
		 *  tried FIRST on the prompt-variation rung; the remaining ladder follows in its usual order. */
		preferredPromptVariantFamily?: string | null;
		/** §5.AA persistence hook: fired ONCE per prompt-variation-rung firing with the winning family (null when the
		 *  whole ladder came up empty) — the live wiring appends it to the model-behavior store. */
		onPromptVariantOutcome?: (outcome: { winningFamily: PromptVariantFamily | null }) => void;
		/** F4.12 test seam: override the truncation-observation store root (defaults to the runtime home). */
		truncationStoreRootDir?: string;
		/** F3.T4: the runtime provider id, mapped to a schema-profile family for the outbound downgrade. */
		providerId?: string | null;
	} = {},
): (
	messages: readonly ChatPromptMessage[],
	allowTools: boolean,
	onToken?: (delta: string) => void,
	usedToolNames?: readonly string[],
	forceToolCall?: boolean,
) => Promise<ChatAgentModelResponse> {
	return async (messages, allowTools, _onToken, usedToolNames, forceToolCall) => {
		// F4.15: modulate only a genuinely selected profile; `{}` remains a strict pass-through for sessions with no
		// selected skill. The compact difficulty prior is turn-local, so a long/hard follow-up can raise an otherwise
		// unopinionated profile without freezing the decision at session creation.
		const instruction = lastUserText(messages);
		const hasProfile = Boolean(options.apiProfile && Object.keys(options.apiProfile).length > 0);
		const hardSignal = /architect|refactor|migrat|concurren|deadlock|security|performance|decompos/iu.test(
			instruction,
		);
		const difficulty = Math.min(1, 0.2 + instruction.length / 4_000 + (hardSignal ? 0.45 : 0));
		const profile = hasProfile
			? modulateApiProfileForDifficulty(options.apiProfile ?? {}, difficulty)
			: options.apiProfile;
		const apiRequest = resolveApiProfileRequest(profile, options.modelId ?? "");
		const baseSampling = options.sampling ?? DEFAULT_SAMPLING;
		let sampling =
			apiRequest.temperature !== null ? { ...baseSampling, temperature: apiRequest.temperature } : baseSampling;
		let wire = messages.map((message) => ({
			role: message.role,
			content: message.content,
			// F2.7b: carry multimodal parts (present only on a vision user turn) so the model SEES images during
			// tool discovery, not just on the final answer. `replaceLastUserText` spreads the message, preserving them.
			...(message.parts ? { parts: message.parts } : {}),
		}));
		if (apiRequest.thinkingDirective) {
			wire = replaceLastUserText(wire, `${lastUserText(messages)}\n\n${apiRequest.thinkingDirective}`);
		}
		const offered = allowTools ? toolDefinitions : [];
		if (hasProfile && options.sampling?.maxTokens === undefined) {
			const outputMode =
				apiRequest.forceToolCall || apiRequest.structuredOutputStrategy === "native_tool_call"
					? "forced_tool_call"
					: apiRequest.preferStructuredOutput
						? "structured"
						: "free_generation";
			const taskClass = offered.length > 1 ? "multi_tool" : offered.length === 1 ? "single_tool" : "trivial_reply";
			sampling = {
				...sampling,
				maxTokens: answerBudgetPrior({
					reasoning: Boolean(options.modelId && isReasoningModel(options.modelId)),
					taskClass,
					outputMode,
					contextWindow: 32_000,
					inputTokens: Math.ceil(wire.reduce((sum, message) => sum + message.content.length, 0) / 4),
					minBudget: outputMode === "forced_tool_call" ? 256 : baseSampling.maxTokens,
				}).maxTokens,
			};
		}
		// §5.AF: which §5.AA recovery rung produced the returned response (stamped on it for the ledger writer).
		let appliedPromptStrategy: string | null = null;
		// F4.15: structured/forced profiles engage on the FIRST request, not after paying for a known-bad auto turn.
		// A malformed/empty direct result safely falls through to the established auto + recovery ladder.
		if (allowTools && offered.length > 0 && (apiRequest.forceToolCall || apiRequest.preferStructuredOutput)) {
			try {
				if (apiRequest.forceToolCall || apiRequest.structuredOutputStrategy === "native_tool_call") {
					const proactive = await client.completeWithTools({ messages: wire, sampling }, offered, {
						toolChoice: "required",
					});
					const call = proactive.toolCalls[0];
					if (call) {
						return {
							text: "",
							toolCalls: [{ id: call.id, name: call.name, arguments: call.arguments }],
							promptStrategy: "skill_profile_native_required",
						};
					}
				} else if (apiRequest.structuredOutputStrategy === "json_schema_grammar" && client.complete) {
					const schema = buildConstrainedToolCallSchema(offered);
					const constrained = schema
						? await client.complete({
								messages: [
									...wire,
									{
										role: "system",
										content: "Return the next required tool call as the constrained JSON object.",
									},
								],
								sampling,
								format: { jsonSchema: schema },
							})
						: null;
					const call = constrained ? parseConstrainedToolCall(constrained.content, offered) : null;
					if (call) {
						return {
							text: "",
							toolCalls: [
								{
									id: `skill-profile-${Date.now().toString(36)}`,
									name: call.name,
									arguments: call.arguments,
								},
							],
							promptStrategy: "skill_profile_json_schema",
						};
					}
				}
			} catch {
				// Preserve the normal auto+recovery path when the proactive local lever is unsupported or temporarily fails.
			}
		}
		let response = await client.completeWithTools({ messages: wire, sampling }, offered);
		const used = new Set(usedToolNames ?? []);
		const initialAnchor = selectToolsForAttempt(offered, instruction, 1);
		const initialAnchoredRemaining = initialAnchor.tools.filter((tool) => !used.has(tool.name));
		const initialOfferedRemaining = offered.filter((tool) => !used.has(tool.name));
		const initialHasFreshCall = response.toolCalls.some((call) => !used.has(call.name));
		const baseBudget = sampling.maxTokens ?? 1024;
		const initialTruncated =
			response.toolCalls.length === 0 &&
			deriveTruncationSignal({
				rawReason: response.finishReason,
				reasoningTokens: response.reasoningTokens,
				tokenBudget: baseBudget,
			}).shouldRetryLarger;
		const modelSupportsThinkingControl = Boolean(options.modelId && supportsThinkingControl(options.modelId));
		// qwen3.8-line request-param switch (live-probed 2026-08-24): thinking off = `reasoning_effort:"none"` on
		// the request; the message token is inert there. Either switch makes the thinking_disable rung available.
		const modelThinkingRequestControl = getThinkingRequestControl(options.modelId);
		const availableStrategies: RetryStrategy[] = [];
		if (allowTools && initialTruncated) {
			availableStrategies.push("raise_token_budget");
			if (modelSupportsThinkingControl || modelThinkingRequestControl) availableStrategies.push("thinking_disable");
		}
		if (
			allowTools &&
			response.toolCalls.length === 0 &&
			offered.length > 1 &&
			selectToolsForAttempt(offered, instruction, 1).reduced
		) {
			availableStrategies.push("reduced_tool_set");
		}
		if (allowTools && response.toolCalls.length === 0 && initialAnchor.matchedNames.length > 0) {
			availableStrategies.push("prompt_variant");
		}
		const constrainedEligible = forceToolCall
			? initialOfferedRemaining.length > 0 && !initialHasFreshCall
			: response.toolCalls.length === 0 &&
				initialAnchor.matchedNames.length > 0 &&
				initialAnchoredRemaining.length > 0;
		if (allowTools && client.complete && constrainedEligible) {
			availableStrategies.push("constrained_schema");
		}
		const retryCursor = createRetryStrategyCursor({
			outcome: "no_tool_call",
			availableStrategies,
			supportsThinkingControl: modelSupportsThinkingControl,
		});
		// §5.AA truncation rung (the CHEAPEST first recovery): a reasoning model can burn its whole token budget on
		// reasoning_content and hit `finish:"length"` BEFORE emitting the tool call (live-confirmed: qwen3-8b spent 200
		// tokens reasoning on a trivial reply). That is a budget truncation, not a complexity failure — so before shrinking
		// the tool set or forcing a schema, just re-ask once with a larger budget. Fires on a no-call turn that EITHER hit
		// `finish:"length"` OR whose `reasoningTokens` (§5.AN signal) consumed ≥90% of the budget (robust to endpoints
		// that report the finish reason differently — reasoning still ate the budget before any call could land).
		// §5.AN: dialect-robust truncation detection via the shared completion-stop-reason core (was the inline
		// `finishReason === "length" || reasoningTokens ≥ 90%·budget`). Byte-identical on /v1 ("length" ⇒ TruncatedTokens),
		// and now also catches a non-/v1 truncation stop reason; `shouldRetryLarger` = truncated-stop OR reasoning-starved.
		if (
			allowTools &&
			response.toolCalls.length === 0 &&
			initialTruncated &&
			retryCursor.claim("raise_token_budget")
		) {
			const bumped = {
				...sampling,
				maxTokens: Math.max(baseBudget * 3, 3072),
				...(modelThinkingRequestControl ? { reasoningEffort: modelThinkingRequestControl.disableValue } : {}),
			};
			// If the model has a thinking soft-switch (e.g. Qwen3 `/no_think`), DISABLE thinking on the retry — that removes
			// the reasoning_content that caused the truncation (the ROOT cause), which is cheaper + more reliable than just
			// enlarging the budget (live: qwen3 reasoning 965 → 2 chars, tool call still emitted). Else just re-ask bigger.
			const retryWire =
				options.modelId && modelSupportsThinkingControl
					? replaceLastUserText(wire, applyThinkingDisable(lastUserText(messages), options.modelId))
					: wire;
			if (modelThinkingRequestControl && !modelSupportsThinkingControl)
				retryCursor.recordCoalesced("thinking_disable");
			// The established chat retry applies the budget raise and soft-switch in ONE provider call. Record both engine
			// rungs as coalesced so selection remains no-circles without adding an identical extra model invocation.
			if (modelSupportsThinkingControl) retryCursor.recordCoalesced("thinking_disable");
			response = await client.completeWithTools({ messages: retryWire, sampling: bumped }, offered);
			// §5.AA escalating truncation retry: if the single (x3) bump STILL truncated (a big reasoner needs more -- live:
			// the 27B truncated at 1024 and needed ~4096 across escalations), grow the budget via the tested raisedTokenBudget
			// (ceiling-clamped so it can't overshoot the context window). Only fires on CONTINUED truncation, so it never
			// affects a turn the first bump already fixed.
			//
			// Default OFF ⇒ EXACTLY ONE escalation (byte-identical to the prior one-shot: current=bumped.maxTokens, attempt=1).
			// With the ADAPTIVE_TRUNCATION_LADDER_FLAG on, keep compounding the budget (attempt=1 each pass, current carried
			// forward = doubling) across up to TRUNCATION_RETRY_MAX_ATTEMPTS passes, breaking the instant the model lands a
			// call, the truncation signal clears, or the ceiling stops the budget from growing. Both the pass count AND the
			// monotonic ceiling clamp bound the turn, so a persistently-truncating model can never spin.
			const maxEscalations = isAdaptiveTruncationLadderEnabled() ? TRUNCATION_RETRY_MAX_ATTEMPTS : 1;
			let escalationBudget = bumped.maxTokens;
			for (let pass = 0; pass < maxEscalations; pass += 1) {
				const stillTruncated =
					response.toolCalls.length === 0 &&
					deriveTruncationSignal({
						rawReason: response.finishReason,
						reasoningTokens: response.reasoningTokens,
						tokenBudget: escalationBudget,
					}).shouldRetryLarger;
				if (!stillTruncated) {
					break;
				}
				const escalated = raisedTokenBudget({
					current: escalationBudget,
					attempt: 1,
					ceiling: TRUNCATION_RETRY_BUDGET_CEILING,
				});
				if (escalated <= escalationBudget) {
					break;
				}
				response = await client.completeWithTools(
					{ messages: retryWire, sampling: { ...sampling, maxTokens: escalated } },
					offered,
				);
				escalationBudget = escalated;
			}
			if (response.toolCalls.length > 0) appliedPromptStrategy = "raise_token_budget";
		}
		// §5.AA task-complexity ladder: a model that returns NO tool call when several were offered AND the instruction
		// names a tool it didn't call is likely drowning in tool-set complexity (grounded: phi-4 emits a clean call with
		// 1 tool but fails with 6). Retry with a progressively narrowed set anchored on the instruction — shrink the ask
		// instead of re-prompting. Only fires when there is a named-but-uncalled tool to anchor on (else no extra calls).
		if (offered.length > 1 && response.toolCalls.length === 0 && retryCursor.claim("reduced_tool_set")) {
			let previousNames: string | null = null;
			for (let level = 1; level <= MAX_ATTEMPT_SIMPLIFICATION_LEVEL; level += 1) {
				const selection = selectToolsForAttempt(offered, instruction, level);
				if (!selection.reduced) {
					break;
				}
				// Bug-hunt fix (2026-07-05): when the instruction names exactly ONE tool, `selectToolsForAttempt` caps at
				// 1 from level 1 onward, so level 2 selects the SAME single tool as level 1 — re-sending an IDENTICAL
				// request the model already just failed on (wasted latency/tokens). Skip a level whose selection is
				// byte-identical to the one just tried.
				const names = selection.tools.map((tool) => tool.name).join(",");
				if (names === previousNames) {
					continue;
				}
				previousNames = names;
				response = await client.completeWithTools({ messages: wire, sampling }, selection.tools);
				if (response.toolCalls.length > 0) {
					appliedPromptStrategy = "reduced_tool_set";
					break;
				}
			}
		}
		// NOTE: narrated-tool-call recovery for the chat path lives in the client (`completeWithTools` runs
		// `parseNarratedToolCalls` over content + reasoning_content when a tools-offered turn returns no structured call —
		// see nklein-local-llm-client.ts). So by here `response.toolCalls` already includes any recovered call.
		//
		// §5.AA prompt-variation rung — between tool-set reduction and the forced-schema last resort. A model that won't
		// act on one phrasing often acts on another (§5.Z), so re-FRAME the same instruction across the variant ladder
		// (imperative → explicit-format → example-led → reason-then-act) and re-ask via the NORMAL tool path with the
		// anchored tool set, giving the model a chance to emit a natural call before we force one. Same proven-safe anchor
		// (the instruction must NAME an offered tool), so a legit prose answer is never re-phrased into a forced action;
		// each family breaks on the first call. The instruction text is preserved verbatim — only the framing changes.
		if (allowTools && response.toolCalls.length === 0 && retryCursor.claim("prompt_variant")) {
			const anchored = initialAnchor;
			if (anchored.matchedNames.length > 0) {
				const toolName = anchored.matchedNames[0];
				// §5.AA learned phrasing: try the model's known-responsive family FIRST (its profile's winning mode),
				// then the rest of the ladder in its usual order — a learned hit saves the whole ladder walk.
				const preferred = PROMPT_VARIANT_LADDER.find((family) => family === options.preferredPromptVariantFamily);
				const ladder = preferred
					? [preferred, ...PROMPT_VARIANT_LADDER.filter((family) => family !== preferred)]
					: PROMPT_VARIANT_LADDER;
				let winningFamily: PromptVariantFamily | null = null;
				for (const family of ladder) {
					const variantText = buildPromptVariant(family, { instruction, toolName });
					const variantWire = replaceLastUserText(wire, variantText);
					const variantResponse = await client.completeWithTools(
						{ messages: variantWire, sampling },
						anchored.tools,
					);
					if (variantResponse.toolCalls.length > 0) {
						response = variantResponse;
						winningFamily = family;
						appliedPromptStrategy = `prompt_variant:${family}`;
						break;
					}
				}
				options.onPromptVariantOutcome?.({ winningFamily });
			}
		}
		// §5.AA constrained-decoding rung — the LAST resort after tool-set reduction AND the client's narrated-recovery
		// both came up empty. Also the FORCE-ADVANCE path (§5.AB loop-spin fix): the loop passes `forceToolCall` when a
		// model is stuck RE-emitting an already-done tool (a repeated structured call the loop dedupes → no progress),
		// which is a real tool call — so gating only on `toolCalls.length === 0` left this rung unreachable and the chain
		// spun to the iteration cap. Fire when there is no call OR the loop asked us to force one.
		//
		// SAFETY: on the `toolCalls.length === 0` path we still require the instruction to NAME an offered tool (the
		// proven-safe anchor) so we never force a call on a legit prose answer to a non-tool question. On the
		// `forceToolCall` path the LOOP's evidence-gate is the safety (it only forces while REQUIRED, named tools remain
		// uncalled), so we may force an UNNAMED-but-offered tool to advance the chain — see the `forceTools` fallback.
		// Bug-hunt fix (2026-07-05): on the FORCE-ADVANCE path, an upstream rung (truncation / reduced-tool-set / prompt-
		// variant — all gated on `response.toolCalls.length === 0`) can recover a genuinely NEW, not-yet-used call within
		// THIS SAME invocation even though `forceToolCall` is set (the PRIMARY call at the top of this function happened
		// to return empty this time — a different case than the "stuck repeating an already-done call" forceToolCall
		// exists for). Forcing anyway would silently discard that fresh call and substitute a separately-forced one,
		// possibly a DIFFERENT tool than the model chose. Only force when there is still nothing to show for it: no call
		// at all, OR every call in `response.toolCalls` names an already-used (non-progressing) tool.
		const hasFreshCall = response.toolCalls.some((call) => !used.has(call.name));
		if (
			allowTools &&
			client.complete &&
			(response.toolCalls.length === 0 || (forceToolCall && !hasFreshCall)) &&
			retryCursor.claim("constrained_schema")
		) {
			const anchored = initialAnchor;
			// Steer a stalled chain to the NEXT step: drop tools already executed this run from the forced set so a weak
			// model can't re-pick a done tool (which the loop dedupes → no progress). Prefer the instruction-anchored
			// remaining tools; when those are exhausted, fall back to ANY offered-but-unused tool (the force-advance path
			// needs a next step to steer to even when the anchor is used up); only when everything is used do we fall back
			// to the anchored set (the no-op / genuinely-finished case, which the evidence-gate would already have ended).
			const anchoredRemaining = anchored.tools.filter((tool) => !used.has(tool.name));
			const offeredRemaining = offered.filter((tool) => !used.has(tool.name));
			const forceTools =
				anchoredRemaining.length > 0
					? anchoredRemaining
					: offeredRemaining.length > 0
						? offeredRemaining
						: anchored.tools;
			// Build the forced schema whenever we have a tool to force.
			// F3.T4 outbound half: downgrade the constrained schema to the endpoint's SAFE dialect before it ships
			// (LM Studio's profile is permissive ⇒ byte-identical today; llama.cpp/openai-compat endpoints get the
			// smallest safe schema instead of a silently-rejected rich one). Inbound near-valid payloads already
			// route through tool-argument-repair at the executor.
			const rawSchema = forceTools.length > 0 ? buildConstrainedToolCallSchema(forceTools) : null;
			const schemaProfile = selectProviderSchemaProfile(schemaProviderFromProviderId(options.providerId ?? null));
			const schema = rawSchema
				? {
						...rawSchema,
						schema: downgradeSchemaForProfile(rawSchema.schema, schemaProfile),
					}
				: null;
			// Bug-hunt fix (2026-07-05): on the PLAIN no-call path, require BOTH a genuine named match (`matchedNames`)
			// AND that named tool still being unused (`anchoredRemaining`). `matchedNames.length > 0` alone is not enough:
			// it's satisfied even when every NAMED tool is already used (forceTools then silently falls back to
			// `offeredRemaining`, an UNRELATED set) — fabricating a forced call on what was really a legitimate prose
			// final answer. And `anchoredRemaining.length > 0` alone is not enough either: when NOTHING was named,
			// `selectToolsForAttempt` falls back to the FULL offered set (`{tools:[...tools], matchedNames:[]}`), so
			// `anchoredRemaining` is non-empty despite no genuine anchor. On the FORCE-ADVANCE path the loop's own
			// evidence-gate is the safety (only forces while genuinely stuck), so any unused offered tool is fair game.
			const anchorGuardsForce = forceToolCall
				? offeredRemaining.length > 0
				: anchored.matchedNames.length > 0 && anchoredRemaining.length > 0;
			if (schema && anchorGuardsForce) {
				// §5.AA/§5.AN native-forcing for REASONING models: their json_schema path silently dead-ends (empty content —
				// grammar vs the reasoning channel, live-probed 2026-07-01), but native `tool_choice:"required"` lands a valid
				// call in the separate tool_calls channel. On the §5.AB FORCE-ADVANCE path (`forceToolCall`) this runs BY
				// DEFAULT for reasoning models (no env flag) — it's a correctness fix for a proven-broken spin, and that path
				// only fires when the loop is already stuck on repeated calls with the run incomplete, so the happy path is
				// untouched. On the plain no-call path it stays behind NKLEIN_NATIVE_FORCE_TOOL_CALL (byte-identical with the
				// flag OFF). Either trigger still requires a reasoning model (native forcing is the reasoning-specific fix; on
				// a non-reasoning model the json_schema path works, so we don't divert it) — matching the flag's prior scope.
				const modelIsReasoning = Boolean(options.modelId) && isReasoningModel(options.modelId ?? "");
				const useNativeForce =
					modelIsReasoning && (Boolean(forceToolCall) || isTruthyEnv(process.env.NKLEIN_NATIVE_FORCE_TOOL_CALL));
				if (useNativeForce) {
					// F4.8b: record that the NATIVE-FORCE path was taken, and — critically — WHY.
					//
					// `useNativeForce` fires when `forceToolCall` is set regardless of the flag, so the flag's
					// MARGINAL effect is only the `!forceToolCall` case. Recording "native force ran" alone would
					// attribute the force-advance path's traffic to the flag and make it look far more active than it
					// is. `flagDriven` isolates the difference the flag actually makes.
					try {
						recordSelfObservation({
							signal: "custom",
							severity: "info",
							message: `Native force tool-call path taken (${forceToolCall ? "force-advance" : "flag-driven"}).`,
							metadata: {
								category: "native_force_tool_call",
								flagDriven: !forceToolCall,
								modelIsReasoning,
							},
						});
					} catch {
						// Telemetry must never break a turn.
					}
					// On the FORCE-ADVANCE path offer the native call a SINGLE tool — the next undone step — not the whole
					// forceTools set. Live-probed 2026-07-01 (qwopus3.6-27b): `tool_choice:"required"` with ONE tool lands a
					// clean STRUCTURED call for exactly that tool even when the model is fixated (it kept narrating the already-
					// done read_file when offered several), whereas a MULTI-tool required call let it narrate the wrong (done)
					// tool → deduped → no progress. The plain no-call path (flag, not forceToolCall) keeps the full anchored set
					// so its existing behavior is unchanged. `forceTools` is non-empty here (schema was built), so [0] is safe.
					const nativeTools = forceToolCall ? [forceTools[0]] : forceTools;
					// On the force-advance path, drive the native call from a TRIMMED, isolated context — NOT the full running
					// transcript. Live root cause (qwopus3.6-27b, 2026-07-01): the accumulated `wire` is saturated with the
					// model's OWN repeated read_file turns + stacked "you already called this / not done yet" nudges, which so
					// reinforce the step-1 fixation that even `tool_choice:"required"` with ONLY run_command offered returns an
					// OFF-MENU structured read_file (the client then drops it → no advance → spin). The SAME instruction with a
					// clean context (original ask + the facts already gathered + an explicit "call <next> now" directive) lands
					// the intended structured call reliably (probe-verified). So for the force we reconstruct that clean context:
					// keep the system framing + the original user instruction + the tool-RESULT notes (the facts), drop the
					// model's narration turns and the nudge chatter, and append the explicit next-step directive.
					const forcedWire: LocalLlmChatMessage[] = forceToolCall
						? buildForceAdvanceContext(wire, [...used], nativeTools[0]?.name ?? "")
						: wire;
					const forced = await client.completeWithTools({ messages: forcedWire, sampling }, nativeTools, {
						toolChoice: "required",
					});
					if (forced.toolCalls.length > 0) {
						const call = forced.toolCalls[0];
						return {
							text: "",
							toolCalls: [{ id: call.id, name: call.name, arguments: call.arguments }],
							promptStrategy: "native_tool_choice_required",
						};
					}
				}
				const constrained = await client.complete({
					messages: [
						...wire,
						{
							role: "system",
							content:
								'Emit the required tool call now as a single JSON object {"tool":"<name>","arguments":{…}} and nothing else.',
						},
					],
					sampling,
					format: { jsonSchema: schema },
				});
				const parsed = parseConstrainedToolCall(constrained.content, forceTools);
				if (parsed) {
					return {
						text: "",
						toolCalls: [
							{ id: `constrained-${Date.now().toString(36)}`, name: parsed.name, arguments: parsed.arguments },
						],
						promptStrategy: "constrained_schema",
					};
				}
			}
		}
		// F4.12 — record a swarm truncation on the settled response. The swarm uses a flat budget (no reasoning reserve),
		// so reasoningBudget=0 + answerBudget=the sent budget; the actual reasoning/answer token split is preserved on the
		// observation from the tool completion's own counts. Best-effort + opt-in (recordTruncationObservation gates).
		recordTruncationObservation({
			modelId: options.modelId,
			surface: "swarm",
			role: "swarm",
			finishReason: response.finishReason,
			raw: response.raw,
			reasoningTokensHint: response.reasoningTokens,
			totalTokensHint: response.totalTokens,
			reasoningBudget: 0,
			answerBudget: sampling.maxTokens ?? DEFAULT_SAMPLING.maxTokens ?? 1024,
			...(options.truncationStoreRootDir ? { rootDir: options.truncationStoreRootDir } : {}),
		});
		return {
			text: cleanModelReply(response.content),
			toolCalls: response.toolCalls.map((call) => ({ id: call.id, name: call.name, arguments: call.arguments })),
			totalTokens: response.totalTokens ?? null,
			promptStrategy: appliedPromptStrategy,
			reasoning: response.reasoningText ?? null,
		};
	};
}

/** The most recent user-authored instruction in the rendered prompt — the anchor for §5.AA tool-set narrowing. */
function lastUserText(messages: readonly ChatPromptMessage[]): string {
	for (let index = messages.length - 1; index >= 0; index -= 1) {
		if (messages[index].role === "user") {
			return messages[index].content;
		}
	}
	return "";
}

/**
 * Return a copy of the wire messages with the LAST user message's content replaced by `text` — the §5.AA
 * prompt-variation rung re-frames the instruction in place, leaving the surrounding context untouched. No-op (a shallow
 * copy) when there is no user message.
 */
function replaceLastUserText<TMessage extends { role: string; content: string }>(
	messages: readonly TMessage[],
	text: string,
): TMessage[] {
	const copy = messages.map((message) => ({ ...message }));
	for (let index = copy.length - 1; index >= 0; index -= 1) {
		if (copy[index].role === "user") {
			copy[index] = { ...copy[index], content: text };
			break;
		}
	}
	return copy;
}

/**
 * Build the TRIMMED, isolated context for a §5.AB force-advance native call.
 *
 * ROOT CAUSE (qwopus3.6-27b, live-probed 2026-07-01): the running transcript still contains the ORIGINAL NUMBERED
 * INSTRUCTION ("1. read_file … 2. run_command … 3. create_card …"). Under `tool_choice:"required"` this model RE-READS
 * that list from the top and restarts at step 1 — returning a structured `read_file` even when ONLY the next tool is
 * offered (the endpoint doesn't constrain `required` to the offered set). Isolated probes are decisive: force context
 * WITH the numbered list → returns the done step-1 tool; force context WITHOUT it (a single-step ask for just the next
 * tool) → returns that tool reliably. So the fix is to DROP the numbered instruction entirely and re-pose the force as a
 * single-step request for the one undone tool.
 *
 * The rebuilt context keeps: the leading system FRAMING (the rendered role/tools/goal prompt + any focus chain — the
 * system messages before the first user turn), the ORIGINAL instruction demoted to a SYSTEM REFERENCE note (so the model
 * can still read the NEXT step's exact arguments, e.g. a card title, from it — but as reference, not an active numbered
 * task the model re-executes from the top), the tool-RESULT facts already gathered (the `Tool result (…)` notes,
 * EXCLUDING the loop's `incomplete-…` nudge notes, which are fixating chatter not facts), and a single fresh USER ask to
 * call the next tool now. The instruction is NOT left as the user turn — probe-verified: as reference-in-system + a
 * single-step user ask, the model emits the next tool WITH its correct args and WITHOUT restarting at step 1.
 * Pure; leading order preserved.
 */
function buildForceAdvanceContext(
	wire: readonly LocalLlmChatMessage[],
	usedToolNames: readonly string[],
	nextToolName: string,
): LocalLlmChatMessage[] {
	const firstUserIndex = wire.findIndex((message) => message.role === "user");
	// Leading system framing (everything before the first user message) — the rendered prompt's role/tools/goal + focus
	// chain. When there's no user message (shouldn't happen on this path) fall back to the whole wire's system messages.
	const framing = wire.slice(0, firstUserIndex >= 0 ? firstUserIndex : wire.length).filter((m) => m.role === "system");
	const instruction = wire.find((message) => message.role === "user");
	// The original instruction, demoted to a REFERENCE note — carries the next step's exact args (title/prompt/command)
	// without being an active numbered task the model re-runs from step 1.
	const reference: LocalLlmChatMessage[] = instruction
		? [{ role: "system", content: `For reference, the overall task is: ${instruction.content}` }]
		: [];
	// Tool-RESULT facts: the folded `Tool result (callId):\n…` system notes (see appendChatToolExchange), EXCLUDING the
	// loop's `incomplete-…` nudge notes (their content is the fixating "not done, keep going" chatter, not a fact).
	const facts = wire.filter(
		(message) =>
			message.role === "system" &&
			message.content.startsWith("Tool result (") &&
			!message.content.startsWith("Tool result (incomplete-"),
	);
	const done = usedToolNames.length > 0 ? `${usedToolNames.join(", ")} ` : "";
	// A single-step ask for JUST the next tool — NO numbered list (which makes the model restart at step 1). It points the
	// model at the reference for that tool's exact arguments. Probe-verified to land the intended structured call (with the
	// correct args) on the fixation-prone reasoning model.
	const nextStep: LocalLlmChatMessage = {
		role: "user",
		content: `The previous step (${done}already completed) is done — its result is shown above. Your next and only action now is to call the ${nextToolName} tool, using the exact arguments specified for that step in the task reference above. Do not repeat any earlier step. Emit the ${nextToolName} tool call and nothing else.`,
	};
	return [...framing, ...reference, ...facts, nextStep];
}

/**
 * Fold an assistant turn's text + its tool results back into the message list for the next agent turn. Rather
 * than the strict OpenAI assistant-tool_calls + tool-role protocol (which the simple prompt-message shape can't
 * carry), the results are appended as plain `system` notes — robust across local models, which then see what each
 * tool returned and continue.
 */
export function appendChatToolExchange(
	messages: readonly ChatPromptMessage[],
	response: ChatAgentModelResponse,
	results: readonly ChatToolResult[],
): ChatPromptMessage[] {
	const appended: ChatPromptMessage[] = [];
	if (response.text.trim().length > 0) {
		appended.push({ role: "assistant", content: response.text });
	}
	for (const result of results) {
		appended.push({ role: "system", content: `Tool result (${result.callId}):\n${result.content}` });
	}
	return [...messages, ...appended];
}

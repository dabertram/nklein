/**
 * Normalize a chat message array so all `system` content sits in a SINGLE system message at index 0 (§5.AA
 * recover-in-!Klein — live-found 2026-07-08 fleet chat-e2e sweep).
 *
 * Some local models ship a strict Jinja chat template that hard-fails the request when a system message is not the very
 * first turn — e.g. qwopus3.5-9b-coder-mtp's template does `raise_exception('System message must be at the beginning')`,
 * so LM Studio returns a 400 ("Unable to generate parser for this template … System message must be at the beginning")
 * BEFORE any generation. That model is otherwise capable (top eval score + drove the full 4-tool chain on 2026-07-01), so
 * the failure is !Klein sending a message order the template rejects, NOT a model limitation — exactly the "recover in
 * !Klein, don't blame the model" pattern. System-first is also the OpenAI-compatible convention, so consolidating is safe
 * for every other model (they already accept a leading system message).
 *
 * This pure transform: collects every `system` message in order, joins their content into ONE leading system message
 * (blank-safe), and appends the non-system messages in their original relative order. No-op (returns the SAME array) when
 * the messages are already system-first-or-absent with at most one system message — so the common path is untouched.
 */

export interface ChatRole {
	role: string;
	content: string;
}

/** True when `messages` already has at most one system message AND it is at index 0 (nothing to normalize). */
function alreadySystemFirst(messages: readonly ChatRole[]): boolean {
	let systemCount = 0;
	let firstSystemIndex = -1;
	for (let i = 0; i < messages.length; i++) {
		if (messages[i]?.role === "system") {
			systemCount++;
			if (firstSystemIndex < 0) {
				firstSystemIndex = i;
			}
		}
	}
	return systemCount === 0 || (systemCount === 1 && firstSystemIndex === 0);
}

/**
 * Return a message array with all `system` content merged into one leading system message (pure). Returns the input array
 * unchanged when it is already system-first with ≤1 system message. Generic over any `{role, content}` shape.
 */
export function mergeSystemMessagesFirst<TMessage extends ChatRole>(messages: readonly TMessage[]): TMessage[] {
	if (alreadySystemFirst(messages)) {
		return messages as TMessage[];
	}
	const systemParts: string[] = [];
	const rest: TMessage[] = [];
	let systemTemplate: TMessage | undefined;
	for (const message of messages) {
		if (message.role === "system") {
			if (systemTemplate === undefined) {
				systemTemplate = message;
			}
			const text = typeof message.content === "string" ? message.content.trim() : "";
			if (text.length > 0) {
				systemParts.push(text);
			}
		} else {
			rest.push(message);
		}
	}
	if (systemTemplate === undefined) {
		return messages as TMessage[];
	}
	const merged: TMessage = { ...systemTemplate, content: systemParts.join("\n\n") };
	return [merged, ...rest];
}

/** True when a message carries ONLY the plain {role, content} keys (no parts/tool metadata a merge could drop). */
function isPlainTextMessage(message: ChatRole): boolean {
	return (
		Object.keys(message).every((key) => key === "role" || key === "content") && typeof message.content === "string"
	);
}

/**
 * Merge CONSECUTIVE same-role `user`/`assistant` messages into one turn (§5.AA recover-in-!Klein, sibling of
 * {@link mergeSystemMessagesFirst} — live-found 2026-07-17): Mistral-family templates hard-500 on non-alternating
 * roles ("conversation roles must alternate user and assistant roles except for tool calls and results", ministral-3
 * via LM Studio engine 500) — hit when the agent loop appends a nudge/user turn onto an already-user tail. Merging
 * adjacent same-role plain-text turns is semantically neutral and OpenAI-convention-safe for every other model.
 *
 * Conservative by design: only PLAIN {role, content} string messages merge (a message carrying `parts`/tool metadata
 * never merges — spreading would silently drop the second message's extras); `system` (handled upstream) and `tool`
 * roles never merge. No-op (returns the SAME array) when nothing is adjacent-same-role — the common path is untouched.
 */
export function mergeConsecutiveSameRoleMessages<TMessage extends ChatRole>(messages: readonly TMessage[]): TMessage[] {
	const mergeable = (message: TMessage): boolean =>
		(message.role === "user" || message.role === "assistant") && isPlainTextMessage(message);
	let needsMerge = false;
	for (let i = 1; i < messages.length; i++) {
		const prev = messages[i - 1];
		const current = messages[i];
		if (prev && current && prev.role === current.role && mergeable(prev) && mergeable(current)) {
			needsMerge = true;
			break;
		}
	}
	if (!needsMerge) {
		return messages as TMessage[];
	}
	const merged: TMessage[] = [];
	for (const message of messages) {
		const last = merged[merged.length - 1];
		if (last && last.role === message.role && mergeable(last) && mergeable(message)) {
			merged[merged.length - 1] = {
				...last,
				content: [last.content, message.content].filter((part) => part.trim().length > 0).join("\n\n"),
			};
			continue;
		}
		merged.push(message);
	}
	return merged;
}

/** An SDK-shaped chat message: content is a plain string OR an array of typed parts (text/image/…). */
export interface SdkShapedMessage {
	role: string;
	content: string | readonly object[];
}

function asParts(content: SdkShapedMessage["content"]): object[] {
	return typeof content === "string" ? [{ type: "text", text: content }] : [...content];
}

/**
 * Keys whose presence marks a message as semantically NON-mergeable (tool/function plumbing must keep its own turn).
 * Identity/bookkeeping keys (id, createdAt, …) are benign — a merged message keeps the FIRST message's identity.
 */
const SDK_NON_MERGEABLE_KEYS = ["tool_calls", "tool_call_id", "function_call", "name"] as const;

/** Part types that are safe to concatenate. Tool-call/tool-result (and reasoning) parts must keep their own turn —
 * the provider conversion pairs them into dedicated wire messages, and a merge would corrupt that pairing. */
const SDK_MERGEABLE_PART_TYPES = new Set(["text", "image", "file"]);

/** Mergeable = user/assistant role, no tool/function metadata, and content is a string or all-safe typed parts. */
function isMergeableSdkMessage(message: SdkShapedMessage): boolean {
	if (message.role !== "user" && message.role !== "assistant") {
		return false;
	}
	if (SDK_NON_MERGEABLE_KEYS.some((key) => (message as unknown as Record<string, unknown>)[key] !== undefined)) {
		return false;
	}
	if (typeof message.content === "string") {
		return true;
	}
	return (
		Array.isArray(message.content) &&
		message.content.every((part) => {
			const type = (part as { type?: unknown }).type;
			// LM Studio-style wire parts use "image_url"; SDK parts use "image" — both are safe payload parts.
			return typeof type === "string" && (SDK_MERGEABLE_PART_TYPES.has(type) || type === "image_url");
		})
	);
}

/**
 * Parts-aware sibling of {@link mergeConsecutiveSameRoleMessages} for SDK-shaped messages (content may be a typed
 * parts ARRAY): adjacent same-role user/assistant messages merge by parts-concatenation (a plain string becomes one
 * text part). Live-found 2026-07-17: the agent loop's beforeModel hooks inject the context-focus brief as its OWN
 * user message ahead of the task's user message → [system, user, user] → Mistral-family templates hard-500
 * ("conversation roles must alternate"). Merging at the hook's exit normalizes EVERY insertion in one place,
 * model-agnostically. Messages carrying extra keys (tool metadata) never merge; no-op returns the SAME array.
 */
export function mergeConsecutiveSameRoleSdkMessages<TMessage extends SdkShapedMessage>(
	messages: readonly TMessage[],
): TMessage[] {
	let needsMerge = false;
	for (let i = 1; i < messages.length; i++) {
		const prev = messages[i - 1];
		const current = messages[i];
		if (
			prev &&
			current &&
			prev.role === current.role &&
			isMergeableSdkMessage(prev) &&
			isMergeableSdkMessage(current)
		) {
			needsMerge = true;
			break;
		}
	}
	if (!needsMerge) {
		return messages as TMessage[];
	}
	const merged: TMessage[] = [];
	for (const message of messages) {
		const last = merged[merged.length - 1];
		if (last && last.role === message.role && isMergeableSdkMessage(last) && isMergeableSdkMessage(message)) {
			merged[merged.length - 1] = {
				...last,
				content: [...asParts(last.content), ...asParts(message.content)] as TMessage["content"],
			};
			continue;
		}
		merged.push(message);
	}
	return merged;
}

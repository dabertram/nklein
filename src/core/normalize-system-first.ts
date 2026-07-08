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

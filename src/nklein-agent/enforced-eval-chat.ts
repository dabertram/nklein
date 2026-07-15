import { maybeEnforceReasoning } from "../chat/chat-enforced-reasoning";
import type { ModelEvalChat, ModelEvalChatChoice } from "./model-eval-runner";

/**
 * F3.16 activation — wrap an eval chat so the model's answer is refined through the enforced-reasoning loop, giving the
 * `enforcedChat` arm of `runModelEval`'s reasoning A/B. The runner stays chat-agnostic; the caller (which can reach the
 * chat layer) builds this and passes it. The `enforce` effect is INJECTED (defaults to {@link maybeEnforceReasoning})
 * so the wrapper mechanics are fully unit-testable. `enabled: true` forces the loop for the measurement (the caller
 * gates WHETHER to build this at all via NKLEIN_ENFORCED_REASONING); the loop's own difficulty gate still applies, so a
 * cell where enforcement wouldn't fire records equal arms — an honest "no benefit here", not a fabricated one.
 */

function draftText(choice: ModelEvalChatChoice | null): string {
	const message = choice?.message;
	return (message?.content?.trim() || message?.reasoning_content?.trim() || "").trim();
}

export function buildEnforcedEvalChat(
	base: ModelEvalChat,
	modelId: string,
	enforce: typeof maybeEnforceReasoning = maybeEnforceReasoning,
): ModelEvalChat {
	return async (messages, extra) => {
		const choice = await base(messages, extra);
		const draft = draftText(choice);
		if (!choice || draft.length === 0) {
			return choice;
		}
		const task = messages
			.filter((message) => message.role === "user")
			.map((message) => message.content)
			.join("\n");
		const enhanced = await enforce({
			task,
			draft,
			modelId,
			enabled: true,
			complete: async ({ system, user }) => {
				const followup = system
					? [
							{ role: "system" as const, content: system },
							{ role: "user" as const, content: user },
						]
					: [{ role: "user" as const, content: user }];
				return draftText(await base(followup, {}));
			},
		});
		return { message: { content: enhanced } };
	};
}

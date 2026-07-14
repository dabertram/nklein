import {
	boundChatImageAttachments,
	buildMultimodalUserContent,
	type ChatImageAttachment,
	decideChatAttachmentAcceptance,
} from "../core/chat-multimodal";
import type { ChatPromptMessage } from "./chat-turn-context";

/**
 * F2.7b — the send-seam that folds a user turn's image attachments into the model prompt, composing the three pure
 * {@link ../core/chat-multimodal} cores: the CAPABILITY gate (the selected model must claim `vision`), the fail-closed
 * BOUNDS gate (count/per-image/total-byte budgets), and OpenAI-compatible CONTENT assembly. On acceptance it attaches
 * multimodal `parts` to the LAST user message (its plain `content` stays the text equivalent for every non-wire
 * reader); on refusal it returns the exact reason and leaves the messages text-only — images are NEVER silently
 * dropped or sent to a model that can't read them.
 */
export function applyImageAttachmentsToPrompt(input: {
	messages: readonly ChatPromptMessage[];
	imageAttachments?: readonly ChatImageAttachment[];
	modelCapabilityIds?: readonly string[];
}): { messages: ChatPromptMessage[]; attachmentNotice: string | null } {
	const messages = input.messages.map((message) => ({ ...message }));
	const images = input.imageAttachments ?? [];
	if (images.length === 0) {
		return { messages, attachmentNotice: null };
	}
	const acceptance = decideChatAttachmentAcceptance({
		kind: "image",
		modelCapabilityIds: input.modelCapabilityIds ?? [],
	});
	if (!acceptance.accepted) {
		return { messages, attachmentNotice: acceptance.reason };
	}
	const bounds = boundChatImageAttachments(images);
	if (!bounds.ok) {
		return { messages, attachmentNotice: bounds.reason };
	}
	let lastUserIndex = -1;
	for (let index = messages.length - 1; index >= 0; index -= 1) {
		if (messages[index]?.role === "user") {
			lastUserIndex = index;
			break;
		}
	}
	const target = lastUserIndex >= 0 ? messages[lastUserIndex] : undefined;
	if (target) {
		messages[lastUserIndex] = { ...target, parts: buildMultimodalUserContent(target.content, images) };
	}
	return { messages, attachmentNotice: null };
}

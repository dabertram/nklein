import {
	boundChatImageAttachments,
	buildMultimodalUserContent,
	type ChatImageAttachment,
	decideChatAttachmentAcceptance,
} from "../core/chat-multimodal";
import { checkImageAgainstProvider, type ProviderImageQuirks } from "../core/multimodal-provider-compat";
import type { ChatPromptMessage } from "./chat-turn-context";

/**
 * F2.7b — the send-seam that folds a user turn's image attachments into the model prompt, composing the three pure
 * {@link ../core/chat-multimodal} cores: the CAPABILITY gate (the selected model must claim `vision`), the fail-closed
 * BOUNDS gate (count/per-image/total-byte budgets), and OpenAI-compatible CONTENT assembly. It ALSO runs the
 * PROVIDER-format compat check (F2.7b hardening): a server with a known image quirk — e.g. LM Studio rejecting WebP —
 * refuses the unsupported format up front with actionable guidance instead of a cryptic upstream 400. On acceptance
 * it attaches multimodal `parts` to the LAST user message (its plain `content` stays the text equivalent for every
 * non-wire reader); on refusal it returns the exact reason and leaves the messages text-only — images are NEVER
 * silently dropped or sent to a model/server that can't read them.
 */
export function applyImageAttachmentsToPrompt(input: {
	messages: readonly ChatPromptMessage[];
	imageAttachments?: readonly ChatImageAttachment[];
	modelCapabilityIds?: readonly string[];
	/** F2.7b hardening: the selected model's server image quirks (e.g. LM Studio = PNG/JPEG only). */
	providerImageQuirks?: ProviderImageQuirks;
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
	// F2.7b hardening: refuse a format the selected model's SERVER is known to reject (e.g. LM Studio + WebP) up front
	// with actionable guidance, rather than letting the request 400 upstream. Absent quirks ⇒ no extra restriction.
	if (input.providerImageQuirks) {
		for (const image of images) {
			const providerCheck = checkImageAgainstProvider(image.mimeType, input.providerImageQuirks);
			if (!providerCheck.ok) {
				return { messages, attachmentNotice: providerCheck.reason };
			}
		}
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

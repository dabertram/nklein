import { describe, expect, it } from "vitest";
import { applyImageAttachmentsToPrompt } from "../../../src/chat/chat-multimodal-turn";
import type { ChatPromptMessage } from "../../../src/chat/chat-turn-context";
import type { ChatImageAttachment } from "../../../src/core/chat-multimodal";
import { resolveProviderImageQuirks } from "../../../src/core/multimodal-provider-compat";

const messages: ChatPromptMessage[] = [
	{ role: "system", content: "sys" },
	{ role: "user", content: "look at this" },
];

// A tiny valid base64 payload — well within the per-image/total byte bounds.
const img = (mimeType: string): ChatImageAttachment => ({ data: "aGVsbG8=", mimeType });

describe("applyImageAttachmentsToPrompt (F2.7b send-seam)", () => {
	it("passes through text-only when there are no attachments", () => {
		const result = applyImageAttachmentsToPrompt({ messages });
		expect(result.attachmentNotice).toBeNull();
		expect(result.messages[1]).not.toHaveProperty("parts");
	});

	it("fails closed at the CAPABILITY gate when the model does not claim vision", () => {
		const result = applyImageAttachmentsToPrompt({
			messages,
			imageAttachments: [img("image/png")],
			modelCapabilityIds: [], // no "vision"
		});
		expect(result.attachmentNotice).toContain("vision");
		expect(result.messages[1]).not.toHaveProperty("parts"); // left text-only, image not attached
	});

	it("fails closed at the PROVIDER-FORMAT gate (LM Studio rejects WebP) with actionable guidance", () => {
		const result = applyImageAttachmentsToPrompt({
			messages,
			imageAttachments: [img("image/webp")],
			modelCapabilityIds: ["vision"],
			providerImageQuirks: resolveProviderImageQuirks("lmstudio"),
		});
		expect(result.attachmentNotice).toContain("PNG or JPEG");
		expect(result.messages[1]).not.toHaveProperty("parts");
	});

	it("attaches multimodal parts to the last user message on acceptance", () => {
		const result = applyImageAttachmentsToPrompt({
			messages,
			imageAttachments: [img("image/png")],
			modelCapabilityIds: ["vision"],
		});
		expect(result.attachmentNotice).toBeNull();
		expect(result.messages[1]).toHaveProperty("parts");
		expect(result.messages[0]).not.toHaveProperty("parts"); // only the last user message
	});
});

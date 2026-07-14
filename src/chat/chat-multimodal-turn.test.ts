import { describe, expect, it } from "vitest";
import type { ChatImageAttachment } from "../core/chat-multimodal";
import { resolveProviderImageQuirks } from "../core/multimodal-provider-compat";
import { applyImageAttachmentsToPrompt } from "./chat-multimodal-turn";
import type { ChatPromptMessage } from "./chat-turn-context";

const PNG_1PX = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
const IMAGE: ChatImageAttachment = { data: PNG_1PX, mimeType: "image/png", name: "shot.png" };

const BASE_MESSAGES: ChatPromptMessage[] = [
	{ role: "system", content: "You are helpful." },
	{ role: "user", content: "What is in this image?" },
];

describe("applyImageAttachmentsToPrompt (F2.7b send seam)", () => {
	it("no attachments → messages unchanged, no notice", () => {
		const result = applyImageAttachmentsToPrompt({ messages: BASE_MESSAGES });
		expect(result.attachmentNotice).toBeNull();
		expect(result.messages).toEqual(BASE_MESSAGES);
		expect(result.messages.some((m) => m.parts)).toBe(false);
	});

	it("vision-capable model + in-budget image → attaches parts to the LAST user message, keeps content text", () => {
		const result = applyImageAttachmentsToPrompt({
			messages: BASE_MESSAGES,
			imageAttachments: [IMAGE],
			modelCapabilityIds: ["vision", "tool_use"],
		});
		expect(result.attachmentNotice).toBeNull();
		const userMessage = result.messages[1];
		expect(userMessage.content).toBe("What is in this image?"); // plain text preserved for non-wire readers
		expect(userMessage.parts).toEqual([
			{ type: "text", text: "What is in this image?" },
			{ type: "image_url", image_url: { url: `data:image/png;base64,${PNG_1PX}` } },
		]);
		// The system message is untouched.
		expect(result.messages[0].parts).toBeUndefined();
	});

	it("model WITHOUT vision → refuses with a reason, sends no parts (fail-closed, text-only)", () => {
		const result = applyImageAttachmentsToPrompt({
			messages: BASE_MESSAGES,
			imageAttachments: [IMAGE],
			modelCapabilityIds: ["tool_use"],
		});
		expect(result.attachmentNotice).toMatch(/vision/i);
		expect(result.messages.some((m) => m.parts)).toBe(false);
	});

	it("over-budget (too many images) → refuses with the exact limit, sends no parts", () => {
		const result = applyImageAttachmentsToPrompt({
			messages: BASE_MESSAGES,
			imageAttachments: [IMAGE, IMAGE, IMAGE, IMAGE, IMAGE], // 5 > default max 4
			modelCapabilityIds: ["vision"],
		});
		expect(result.attachmentNotice).toMatch(/at most 4/);
		expect(result.messages.some((m) => m.parts)).toBe(false);
	});

	it("does not mutate the caller's message array", () => {
		const messages: ChatPromptMessage[] = [{ role: "user", content: "hi" }];
		applyImageAttachmentsToPrompt({ messages, imageAttachments: [IMAGE], modelCapabilityIds: ["vision"] });
		expect(messages[0].parts).toBeUndefined();
	});

	it("F2.7b hardening: a WebP image is REFUSED for LM Studio (its known bug) with PNG/JPEG guidance — no parts", () => {
		const webp: ChatImageAttachment = { data: PNG_1PX, mimeType: "image/webp", name: "screenshot.webp" };
		const result = applyImageAttachmentsToPrompt({
			messages: BASE_MESSAGES,
			imageAttachments: [webp],
			modelCapabilityIds: ["vision"],
			providerImageQuirks: resolveProviderImageQuirks("lmstudio"),
		});
		expect(result.attachmentNotice).toMatch(/PNG or JPEG/);
		expect(result.attachmentNotice).toMatch(/LM Studio/);
		expect(result.messages.some((m) => m.parts)).toBe(false);
	});

	it("a PNG passes the LM Studio provider gate and attaches parts", () => {
		const result = applyImageAttachmentsToPrompt({
			messages: BASE_MESSAGES,
			imageAttachments: [IMAGE],
			modelCapabilityIds: ["vision"],
			providerImageQuirks: resolveProviderImageQuirks("lmstudio"),
		});
		expect(result.attachmentNotice).toBeNull();
		expect(result.messages[1].parts).toBeDefined();
	});
});

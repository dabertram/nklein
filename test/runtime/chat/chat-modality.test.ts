import { describe, expect, it } from "vitest";
import { isChatModalityAllowed, resolveChatModalities } from "../../../src/chat/chat-modality";

describe("chat-modality", () => {
	it("text is always available; image/attachment gate on capabilities; audio degrades to text", () => {
		expect(resolveChatModalities({ supportsVision: true, supportsAttachments: true })).toEqual({
			text: true,
			image: true,
			attachment: true,
			audio: false,
		});
		expect(resolveChatModalities({})).toEqual({ text: true, image: false, attachment: false, audio: false });
	});

	it("isChatModalityAllowed reflects the resolved access", () => {
		const visionOnly = { supportsVision: true };
		expect(isChatModalityAllowed(visionOnly, "text")).toBe(true);
		expect(isChatModalityAllowed(visionOnly, "image")).toBe(true);
		expect(isChatModalityAllowed(visionOnly, "attachment")).toBe(false);
		expect(isChatModalityAllowed(visionOnly, "audio")).toBe(false);

		const textOnly = {};
		expect(isChatModalityAllowed(textOnly, "text")).toBe(true);
		expect(isChatModalityAllowed(textOnly, "image")).toBe(false);
	});
});

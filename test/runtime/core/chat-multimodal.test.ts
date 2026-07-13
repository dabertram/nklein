import { describe, expect, it } from "vitest";
import {
	base64DecodedBytes,
	boundChatImageAttachments,
	buildMultimodalUserContent,
	type ChatImageAttachment,
	decideChatAttachmentAcceptance,
} from "../../../src/core/chat-multimodal";

/**
 * F2.7 — capability-gated multimodal chat cores: the vision capability gate (audio/PDF refused outright),
 * fail-closed attachment bounds (refuse, never silently truncate), and OpenAI-compatible content assembly.
 */

function image(bytes: number, overrides: Partial<ChatImageAttachment> = {}): ChatImageAttachment {
	// base64 of `bytes` zeros: 4 chars per 3 bytes (unpadded shape is fine for the size math).
	const data = "A".repeat(Math.ceil((bytes * 4) / 3));
	return { data, mimeType: "image/png", ...overrides };
}

describe("decideChatAttachmentAcceptance", () => {
	it("accepts images ONLY when the selected model claims vision", () => {
		expect(
			decideChatAttachmentAcceptance({ kind: "image", modelCapabilityIds: ["vision", "tool_use"] }).accepted,
		).toBe(true);
		const refused = decideChatAttachmentAcceptance({ kind: "image", modelCapabilityIds: ["tool_use"] });
		expect(refused.accepted).toBe(false);
		expect(refused.reason).toContain("vision");
	});

	it("refuses audio and PDF outright with an explanatory reason (no local parser yet)", () => {
		for (const kind of ["audio", "pdf"] as const) {
			const refused = decideChatAttachmentAcceptance({ kind, modelCapabilityIds: ["vision"] });
			expect(refused.accepted).toBe(false);
			expect(refused.reason).toContain("not supported yet");
		}
	});
});

describe("boundChatImageAttachments", () => {
	it("enforces count, per-image, and total budgets with the exact limit named", () => {
		expect(boundChatImageAttachments([image(1024)]).ok).toBe(true);
		const tooMany = boundChatImageAttachments([image(10), image(10), image(10)], { maxCount: 2 });
		expect(tooMany).toMatchObject({ ok: false });
		expect((tooMany as { reason: string }).reason).toContain("at most 2");

		const tooBig = boundChatImageAttachments([image(2048, { name: "big.png" })], { maxBytesEach: 1024 });
		expect((tooBig as { reason: string }).reason).toContain("per-image limit is 1 KiB");

		const totalOver = boundChatImageAttachments([image(700), image(700)], {
			maxBytesEach: 1024,
			maxTotalBytes: 1024,
		});
		expect((totalOver as { reason: string }).reason).toContain("per-message limit");
	});

	it("refuses unsupported mime types and empty payloads (fail-closed, never silently drops)", () => {
		expect(
			(boundChatImageAttachments([image(10, { mimeType: "image/tiff" })]) as { reason: string }).reason,
		).toContain("Unsupported image type");
		expect(
			(boundChatImageAttachments([{ data: "  ", mimeType: "image/png" }]) as { reason: string }).reason,
		).toContain("empty");
	});

	it("base64DecodedBytes accounts for padding", () => {
		expect(base64DecodedBytes(Buffer.from("abc").toString("base64"))).toBe(3);
		expect(base64DecodedBytes(Buffer.from("ab").toString("base64"))).toBe(2);
		expect(base64DecodedBytes("")).toBe(0);
	});
});

describe("buildMultimodalUserContent", () => {
	it("emits the text part first, then one data-URL image part per attachment in order", () => {
		const parts = buildMultimodalUserContent("what is this? ", [
			{ data: "AAAA", mimeType: "image/PNG" },
			{ data: "BBBB", mimeType: "image/jpeg", name: "b.jpg" },
		]);
		expect(parts).toEqual([
			{ type: "text", text: "what is this?" },
			{ type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } },
			{ type: "image_url", image_url: { url: "data:image/jpeg;base64,BBBB" } },
		]);
		// An image-only message has no empty text part.
		expect(buildMultimodalUserContent("   ", [{ data: "AAAA", mimeType: "image/png" }])).toHaveLength(1);
	});
});

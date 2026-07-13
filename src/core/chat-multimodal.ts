/**
 * F2.7 (§5.M) — capability-gated MULTIMODAL chat, the pure cores: images first, audio/PDF stay refused until a
 * local model + parser actually support them. Three pieces the wiring composes:
 *   - the CAPABILITY gate: attachments are accepted only when the SELECTED LOCAL MODEL claims the capability
 *     (llmfit `vision` tag for images) — never on hope; unsupported kinds carry an explanatory refusal;
 *   - the BOUNDS gate: hard per-image / per-message byte + count budgets so attachments can't blow the context
 *     window or the transcript store (fail-closed: over-budget refuses, never truncates silently);
 *   - CONTENT assembly: OpenAI-compatible content parts (`text` + `image_url` data URLs) for the local adapter.
 * Pure + total; the send-pipeline/UI wiring is the follow-up leaf.
 */

export type ChatAttachmentKind = "image" | "audio" | "pdf";

export interface ChatImageAttachment {
	/** Base64 payload (no data-URL prefix). */
	data: string;
	mimeType: string;
	name?: string;
}

const SUPPORTED_IMAGE_MIME_TYPES: ReadonlySet<string> = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

export interface ChatAttachmentAcceptance {
	accepted: boolean;
	reason: string;
}

/**
 * The capability gate: an attachment kind is accepted only when the selected model CLAIMS the capability.
 * Audio/PDF are refused outright in this increment (no local parser integration yet) — the reason says so
 * rather than pretending the model will cope.
 */
export function decideChatAttachmentAcceptance(input: {
	kind: ChatAttachmentKind;
	/** The selected model's normalized llmfit capability ids (e.g. `["vision", "tool_use"]`); [] when unknown. */
	modelCapabilityIds: readonly string[];
}): ChatAttachmentAcceptance {
	if (input.kind === "audio" || input.kind === "pdf") {
		return {
			accepted: false,
			reason: `${input.kind === "audio" ? "Audio" : "PDF"} attachments are not supported yet — no local parser is integrated. Images are supported on vision-capable models.`,
		};
	}
	if (!input.modelCapabilityIds.includes("vision")) {
		return {
			accepted: false,
			reason: "The selected model does not claim vision support — pick a vision-capable local model to send images.",
		};
	}
	return { accepted: true, reason: "" };
}

export interface ChatImageBounds {
	/** Max images per message. Default 4. */
	maxCount?: number;
	/** Max DECODED bytes per image. Default 4 MiB. */
	maxBytesEach?: number;
	/** Max total decoded bytes per message. Default 8 MiB. */
	maxTotalBytes?: number;
}

export type ChatImageBoundsResult = { ok: true; totalBytes: number } | { ok: false; reason: string };

/** Approximate decoded size of a base64 payload (¾ of the encoded length, padding-adjusted). */
export function base64DecodedBytes(data: string): number {
	const trimmed = data.trim();
	if (trimmed.length === 0) {
		return 0;
	}
	const padding = trimmed.endsWith("==") ? 2 : trimmed.endsWith("=") ? 1 : 0;
	return Math.max(0, Math.floor((trimmed.length * 3) / 4) - padding);
}

/**
 * The bounds gate (fail-closed): count, per-image, and total-byte budgets, plus a supported-mime check. An
 * over-budget message REFUSES with the exact limit named — attachments are never silently dropped or resized.
 */
export function boundChatImageAttachments(
	images: readonly ChatImageAttachment[],
	bounds: ChatImageBounds = {},
): ChatImageBoundsResult {
	const maxCount = Math.max(1, Math.trunc(bounds.maxCount ?? 4));
	const maxBytesEach = Math.max(1, Math.trunc(bounds.maxBytesEach ?? 4 * 1024 * 1024));
	const maxTotalBytes = Math.max(1, Math.trunc(bounds.maxTotalBytes ?? 8 * 1024 * 1024));
	if (images.length > maxCount) {
		return { ok: false, reason: `Too many images: ${images.length} attached, at most ${maxCount} per message.` };
	}
	let totalBytes = 0;
	for (const image of images) {
		if (!SUPPORTED_IMAGE_MIME_TYPES.has(image.mimeType.toLowerCase())) {
			return { ok: false, reason: `Unsupported image type ${image.mimeType} (png/jpeg/webp/gif only).` };
		}
		const bytes = base64DecodedBytes(image.data);
		if (bytes === 0) {
			return { ok: false, reason: `Image ${image.name ?? ""} is empty.`.replace("  ", " ") };
		}
		if (bytes > maxBytesEach) {
			return {
				ok: false,
				reason:
					`Image ${image.name ?? ""} is ${Math.ceil(bytes / 1024)} KiB — the per-image limit is ${Math.floor(maxBytesEach / 1024)} KiB.`.replace(
						"  ",
						" ",
					),
			};
		}
		totalBytes += bytes;
	}
	if (totalBytes > maxTotalBytes) {
		return {
			ok: false,
			reason: `Attachments total ${Math.ceil(totalBytes / 1024)} KiB — the per-message limit is ${Math.floor(maxTotalBytes / 1024)} KiB.`,
		};
	}
	return { ok: true, totalBytes };
}

export type MultimodalContentPart = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } };

/**
 * Assemble the OpenAI-compatible content parts for a user turn with images: the text part first (when
 * non-empty), then one `image_url` data-URL part per image, in order.
 */
export function buildMultimodalUserContent(
	text: string,
	images: readonly ChatImageAttachment[],
): MultimodalContentPart[] {
	const parts: MultimodalContentPart[] = [];
	const trimmed = text.trim();
	if (trimmed) {
		parts.push({ type: "text", text: trimmed });
	}
	for (const image of images) {
		parts.push({
			type: "image_url",
			image_url: { url: `data:${image.mimeType.toLowerCase()};base64,${image.data.trim()}` },
		});
	}
	return parts;
}

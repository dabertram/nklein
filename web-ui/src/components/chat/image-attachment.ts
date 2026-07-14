import type { ChatImageAttachmentInput } from "./use-chat-data";

/**
 * F2.7b hardening — normalize a picked image to a format every local vision server reliably accepts BEFORE it ever
 * leaves the browser. Several servers (notably LM Studio) reject WebP/GIF at their OpenAI-compatible vision endpoint
 * with `'url' field must be a base64 encoded image`, which breaks the agent-default WebP screenshot (Cline/Kilocode/
 * Roo hit the same bug). So: PNG/JPEG pass through untouched; anything else (WebP, GIF, AVIF, …) is transcoded to PNG
 * via a canvas so the request is universally safe. Provider-agnostic and dependency-free — the server-side compat
 * gate (`multimodal-provider-compat`) is the defensive backstop for the API path.
 */

const PASS_THROUGH_MIME_TYPES = new Set(["image/png", "image/jpeg"]);

function readAsDataUrl(file: File): Promise<string> {
	return new Promise((resolve) => {
		const reader = new FileReader();
		reader.onload = () => resolve(String(reader.result ?? ""));
		reader.onerror = () => resolve("");
		reader.readAsDataURL(file);
	});
}

function base64FromDataUrl(dataUrl: string): string | null {
	const comma = dataUrl.indexOf(",");
	return comma < 0 ? null : dataUrl.slice(comma + 1);
}

/** Re-encode a data URL to PNG via a canvas; resolves null when the image can't be decoded. */
async function transcodeDataUrlToPng(dataUrl: string): Promise<string | null> {
	const image = new Image();
	const loaded = await new Promise<boolean>((resolve) => {
		image.onload = () => resolve(true);
		image.onerror = () => resolve(false);
		image.src = dataUrl;
	});
	if (!loaded || image.naturalWidth === 0 || image.naturalHeight === 0) {
		return null;
	}
	const canvas = document.createElement("canvas");
	canvas.width = image.naturalWidth;
	canvas.height = image.naturalHeight;
	const ctx = canvas.getContext("2d");
	if (!ctx) {
		return null;
	}
	ctx.drawImage(image, 0, 0);
	return base64FromDataUrl(canvas.toDataURL("image/png"));
}

/** Read + normalize one picked image file to a safe attachment (PNG/JPEG kept; anything else → PNG). Null on failure. */
export async function fileToSafeAttachment(file: File): Promise<ChatImageAttachmentInput | null> {
	if (!file.type.startsWith("image/")) {
		return null;
	}
	const dataUrl = await readAsDataUrl(file);
	if (!dataUrl) {
		return null;
	}
	if (PASS_THROUGH_MIME_TYPES.has(file.type)) {
		const data = base64FromDataUrl(dataUrl);
		return data ? { data, mimeType: file.type, name: file.name } : null;
	}
	// Transcode WebP/GIF/etc → PNG so the request is safe for every local vision server.
	const pngData = await transcodeDataUrlToPng(dataUrl);
	if (!pngData) {
		return null;
	}
	const pngName = `${file.name.replace(/\.[^.]+$/, "")}.png`;
	return { data: pngData, mimeType: "image/png", name: pngName };
}

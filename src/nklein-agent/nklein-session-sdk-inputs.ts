import type { RuntimeTaskImage } from "../core/api-contract";

/**
 * Pure resolvers that turn runtime task values into the shapes the NKlein SDK session expects,
 * extracted from nklein-session-runtime. No I/O — just validation/normalization at the SDK boundary.
 */

/** Builds `data:<mime>;base64,<data>` user-image strings, dropping entries missing a mime type or data. */
export function toSdkUserImages(images?: RuntimeTaskImage[]): string[] | undefined {
	if (!images || images.length === 0) {
		return undefined;
	}
	const userImages = images
		.map((image) => {
			const mimeType = image.mimeType.trim();
			const data = image.data.trim();
			if (!mimeType || !data) {
				return null;
			}
			return `data:${mimeType};base64,${data}`;
		})
		.filter((image): image is string => image !== null);
	return userImages.length > 0 ? userImages : undefined;
}

/** A positive finite API timeout (truncated to ms), or undefined to mean "no timeout" (0/null/negative/NaN). */
export function resolveSdkApiTimeoutMs(timeoutMs: number | null | undefined): number | undefined {
	if (timeoutMs === undefined || timeoutMs === null || timeoutMs === 0) {
		return undefined;
	}
	if (!Number.isFinite(timeoutMs) || timeoutMs < 0) {
		return undefined;
	}
	return Math.trunc(timeoutMs);
}

/** A positive finite context-window size (truncated to whole tokens), or null when unset/invalid. */
export function resolveContextWindowTokens(contextWindow: number | null | undefined): number | null {
	if (typeof contextWindow !== "number" || !Number.isFinite(contextWindow) || contextWindow <= 0) {
		return null;
	}
	return Math.trunc(contextWindow);
}

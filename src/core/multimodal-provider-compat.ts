/**
 * F2.7b hardening — PROVIDER image-format compatibility. Some local model servers reject perfectly valid
 * OpenAI-compatible image content because of server-side quirks, NOT anything wrong with !Klein's request. The
 * live example: LM Studio's vision endpoint rejects WebP (and GIF) screenshots with `'url' field must be a base64
 * encoded image` — even though the base64 data URL is well-formed — which breaks Cline/Kilocode/Roo and any harness
 * that sends the agent-default WebP screenshot (lmstudio-ai/lmstudio-bug-tracker#1027).
 *
 * !Klein stays robust in two places:
 *   1. the composer transcodes every attachment to PNG client-side (so the common path never sends WebP); and
 *   2. this pure server-side layer is the extensible chokepoint — a per-provider table of the image mime types a
 *      server is KNOWN to accept, so an attachment reaching the send seam in a format the provider can't read is
 *      refused with an ACTIONABLE reason ("attach a PNG or JPEG") instead of a cryptic upstream 400. A provider with
 *      no known quirk keeps the permissive default (every supported format), so this only tightens where we KNOW a
 *      server is finicky, and new quirks are one table entry away.
 */

export interface ProviderImageQuirks {
	/** Human label for refusal messages (e.g. "LM Studio"). */
	label: string;
	/** Image mime types this provider's OpenAI-compatible endpoint is KNOWN to accept, lowercased. */
	supportedImageMimeTypes: readonly string[];
}

/** The formats the pure bounds gate permits in the first place — the permissive default for unknown providers. */
export const DEFAULT_SUPPORTED_IMAGE_MIME_TYPES: readonly string[] = [
	"image/png",
	"image/jpeg",
	"image/webp",
	"image/gif",
];

/** Universally-safe formats every known local vision server accepts. */
const UNIVERSALLY_SAFE_IMAGE_MIME_TYPES: readonly string[] = ["image/png", "image/jpeg"];

/**
 * Per-provider KNOWN quirks, keyed by a normalized provider id. LM Studio (both id spellings seen in the wild)
 * rejects WebP/GIF at its vision endpoint, so it is pinned to the universally-safe set.
 */
export const PROVIDER_IMAGE_QUIRKS: Readonly<Record<string, ProviderImageQuirks>> = {
	"lm-studio": { label: "LM Studio", supportedImageMimeTypes: UNIVERSALLY_SAFE_IMAGE_MIME_TYPES },
	lmstudio: { label: "LM Studio", supportedImageMimeTypes: UNIVERSALLY_SAFE_IMAGE_MIME_TYPES },
	lm_studio: { label: "LM Studio", supportedImageMimeTypes: UNIVERSALLY_SAFE_IMAGE_MIME_TYPES },
};

/** Resolve a provider's image quirks; unknown providers get the permissive default (no tightening we can't justify). */
export function resolveProviderImageQuirks(providerId: string | null | undefined): ProviderImageQuirks {
	const key = (providerId ?? "").trim().toLowerCase();
	return (
		PROVIDER_IMAGE_QUIRKS[key] ?? {
			label: providerId?.trim() || "the model server",
			supportedImageMimeTypes: DEFAULT_SUPPORTED_IMAGE_MIME_TYPES,
		}
	);
}

export type ProviderImageCheck = { ok: true } | { ok: false; reason: string };

/**
 * Whether a single image is safe to send to the provider. Fail-closed with an ACTIONABLE reason when the provider
 * is known not to accept the format — the caller surfaces it instead of letting the request 400 upstream.
 */
export function checkImageAgainstProvider(mimeType: string, quirks: ProviderImageQuirks): ProviderImageCheck {
	if (quirks.supportedImageMimeTypes.includes(mimeType.trim().toLowerCase())) {
		return { ok: true };
	}
	return {
		ok: false,
		reason:
			`${quirks.label} can't read ${mimeType} images — attach a PNG or JPEG instead. ` +
			`(This is a known ${quirks.label} limitation with that format, not a problem with the image.)`,
	};
}

/**
 * F5.4 (pure) — resolve an onboarding slide's declared media into the ONE source to render, or a text fallback.
 *
 * The onboarding carousel is CSP-locked to `self`: the served Content-Security-Policy blocks media from any other
 * origin (the inherited Cline demos streamed from external signed S3 URLs and rendered as broken frames — see the
 * carousel's TASK_START_ONBOARDING_SLIDES note). This resolver enforces that by construction: only a SELF-HOSTED
 * asset (a relative/root-relative path served by the app itself) is eligible; any absolute, protocol-relative,
 * `data:`, or `blob:` URL is rejected so the slide degrades to its title + description (text) rather than a broken
 * media frame. Media is therefore OPTIONAL with a guaranteed text fallback — exactly F5.4's contract.
 *
 * Pure + deterministic (no `window`/DOM): "self-hosted" is decided structurally — a bare path is same-origin by
 * definition; anything carrying a scheme or authority could point off-origin and is refused.
 */

export interface OnboardingMediaSlideSources {
	readonly assetVideoUrl?: string;
	readonly assetImageUrl?: string;
	/** A stem the app serves an animated `${stem}.gif` for (a self-hosted image). */
	readonly assetStemPath?: string;
}

export type OnboardingMediaResolution =
	| { readonly kind: "video"; readonly src: string }
	| { readonly kind: "image"; readonly src: string }
	/** No CSP-self-compliant source ⇒ render the slide as title + description only. */
	| { readonly kind: "text" };

/**
 * Whether a media URL is self-hosted (CSP `self`-eligible): a non-empty path with no scheme and no authority. Rejects
 * `http(s):`, protocol-relative `//host`, and `data:`/`blob:` (all of which either leave the origin or are blocked by a
 * `self`-only media/img CSP). A root-relative (`/assets/…`) or relative (`assets/…`) path is served by the app itself.
 */
export function isSelfHostedMediaUrl(url: string | undefined | null): url is string {
	if (typeof url !== "string") {
		return false;
	}
	const trimmed = url.trim();
	if (trimmed.length === 0) {
		return false;
	}
	// Protocol-relative (`//host/…`) points at another authority.
	if (trimmed.startsWith("//")) {
		return false;
	}
	// Any explicit scheme (http:, https:, data:, blob:, file:, …) is not a plain same-origin path.
	if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed)) {
		return false;
	}
	return true;
}

/**
 * Resolve the single media source to render for a slide, honoring precedence video → image → stem(`.gif`), skipping
 * any non-self-hosted candidate, and falling back to `{ kind: "text" }` when nothing compliant is declared.
 */
export function resolveOnboardingMediaSource(slide: OnboardingMediaSlideSources): OnboardingMediaResolution {
	if (isSelfHostedMediaUrl(slide.assetVideoUrl)) {
		return { kind: "video", src: slide.assetVideoUrl };
	}
	if (isSelfHostedMediaUrl(slide.assetImageUrl)) {
		return { kind: "image", src: slide.assetImageUrl };
	}
	if (isSelfHostedMediaUrl(slide.assetStemPath)) {
		return { kind: "image", src: `${slide.assetStemPath}.gif` };
	}
	return { kind: "text" };
}

/** Convenience for the carousel's frame gate: does the slide have a renderable (self-hosted) media source? */
export function hasSelfHostedOnboardingMedia(slide: OnboardingMediaSlideSources): boolean {
	return resolveOnboardingMediaSource(slide).kind !== "text";
}

import { describe, expect, it } from "vitest";
import {
	hasSelfHostedOnboardingMedia,
	isSelfHostedMediaUrl,
	resolveOnboardingMediaSource,
} from "./onboarding-media-source";

/** F5.4 — CSP-self-only onboarding media resolution with a guaranteed text fallback. */
describe("isSelfHostedMediaUrl", () => {
	it("accepts relative and root-relative paths", () => {
		expect(isSelfHostedMediaUrl("/assets/onboarding/demo.mp4")).toBe(true);
		expect(isSelfHostedMediaUrl("assets/onboarding/demo.gif")).toBe(true);
	});

	it("rejects off-origin, protocol-relative, data:, blob:, and empty URLs", () => {
		expect(isSelfHostedMediaUrl("https://s3.amazonaws.com/signed/clip.mp4")).toBe(false);
		expect(isSelfHostedMediaUrl("http://localhost:9999/x.mp4")).toBe(false);
		expect(isSelfHostedMediaUrl("//cdn.example.com/x.mp4")).toBe(false);
		expect(isSelfHostedMediaUrl("data:video/mp4;base64,AAAA")).toBe(false);
		expect(isSelfHostedMediaUrl("blob:abc")).toBe(false);
		expect(isSelfHostedMediaUrl("")).toBe(false);
		expect(isSelfHostedMediaUrl(undefined)).toBe(false);
	});
});

describe("resolveOnboardingMediaSource", () => {
	it("prefers video, then image, then a stem's .gif — all self-hosted", () => {
		expect(resolveOnboardingMediaSource({ assetVideoUrl: "/a.mp4", assetImageUrl: "/a.png" })).toEqual({
			kind: "video",
			src: "/a.mp4",
		});
		expect(resolveOnboardingMediaSource({ assetImageUrl: "/a.png" })).toEqual({ kind: "image", src: "/a.png" });
		expect(resolveOnboardingMediaSource({ assetStemPath: "/assets/onboarding/board" })).toEqual({
			kind: "image",
			src: "/assets/onboarding/board.gif",
		});
	});

	it("skips a non-self-hosted candidate and uses the next compliant one", () => {
		// External video is refused; the self-hosted image wins instead of a broken frame.
		expect(
			resolveOnboardingMediaSource({ assetVideoUrl: "https://s3/clip.mp4", assetImageUrl: "/local.png" }),
		).toEqual({ kind: "image", src: "/local.png" });
	});

	it("falls back to text when no compliant source exists (the F5.4 optional-media contract)", () => {
		expect(resolveOnboardingMediaSource({})).toEqual({ kind: "text" });
		expect(resolveOnboardingMediaSource({ assetVideoUrl: "https://s3/clip.mp4" })).toEqual({ kind: "text" });
		expect(hasSelfHostedOnboardingMedia({ assetVideoUrl: "https://s3/clip.mp4" })).toBe(false);
		expect(hasSelfHostedOnboardingMedia({ assetImageUrl: "/ok.png" })).toBe(true);
	});
});

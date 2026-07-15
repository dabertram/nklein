import { describe, expect, it } from "vitest";
import {
	checkImageAgainstProvider,
	DEFAULT_SUPPORTED_IMAGE_MIME_TYPES,
	resolveProviderImageQuirks,
} from "../../../src/core/multimodal-provider-compat";

describe("resolveProviderImageQuirks (F2.7b)", () => {
	it("pins every LM Studio id spelling to the universally-safe (PNG/JPEG) set, case/space-insensitively", () => {
		for (const id of ["lmstudio", "lm-studio", "lm_studio", "  LM-Studio  "]) {
			const quirks = resolveProviderImageQuirks(id);
			expect(quirks.label).toBe("LM Studio");
			expect([...quirks.supportedImageMimeTypes]).toEqual(["image/png", "image/jpeg"]);
		}
	});

	it("gives unknown providers the permissive default and a sensible label", () => {
		const quirks = resolveProviderImageQuirks("openai");
		expect(quirks.supportedImageMimeTypes).toEqual(DEFAULT_SUPPORTED_IMAGE_MIME_TYPES);
		expect(quirks.label).toBe("openai");
		expect(resolveProviderImageQuirks(null).label).toBe("the model server");
	});
});

describe("checkImageAgainstProvider", () => {
	const lmStudio = resolveProviderImageQuirks("lmstudio");

	it("accepts a supported format (case-insensitively)", () => {
		expect(checkImageAgainstProvider("image/png", lmStudio)).toEqual({ ok: true });
		expect(checkImageAgainstProvider("IMAGE/JPEG", lmStudio)).toEqual({ ok: true });
	});

	it("fails closed on a known-unsupported format with an actionable reason", () => {
		const result = checkImageAgainstProvider("image/webp", lmStudio);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.reason).toContain("PNG or JPEG");
			expect(result.reason).toContain("LM Studio");
		}
	});

	it("permits WebP for an unknown provider (only tightens where a quirk is known)", () => {
		expect(checkImageAgainstProvider("image/webp", resolveProviderImageQuirks("openai"))).toEqual({ ok: true });
	});
});

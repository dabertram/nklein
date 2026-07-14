import { describe, expect, it } from "vitest";
import {
	checkImageAgainstProvider,
	DEFAULT_SUPPORTED_IMAGE_MIME_TYPES,
	resolveProviderImageQuirks,
} from "./multimodal-provider-compat";

describe("provider image compat (F2.7b hardening for LM Studio's WebP bug)", () => {
	it("LM Studio (all id spellings) is pinned to PNG/JPEG — WebP/GIF refused with actionable guidance", () => {
		for (const id of ["lm-studio", "lmstudio", "LM_Studio", "LM-Studio"]) {
			const quirks = resolveProviderImageQuirks(id);
			expect(quirks.label).toBe("LM Studio");
			expect(checkImageAgainstProvider("image/png", quirks)).toEqual({ ok: true });
			expect(checkImageAgainstProvider("image/jpeg", quirks)).toEqual({ ok: true });

			const webp = checkImageAgainstProvider("image/webp", quirks);
			expect(webp.ok).toBe(false);
			if (!webp.ok) {
				expect(webp.reason).toMatch(/PNG or JPEG/);
				expect(webp.reason).toMatch(/LM Studio/);
			}
			expect(checkImageAgainstProvider("image/gif", quirks).ok).toBe(false);
		}
	});

	it("an unknown provider keeps the permissive default (every supported format) — no tightening we can't justify", () => {
		const quirks = resolveProviderImageQuirks("some-new-server");
		expect(quirks.supportedImageMimeTypes).toEqual(DEFAULT_SUPPORTED_IMAGE_MIME_TYPES);
		for (const mime of ["image/png", "image/jpeg", "image/webp", "image/gif"]) {
			expect(checkImageAgainstProvider(mime, quirks)).toEqual({ ok: true });
		}
	});

	it("null/blank provider ids resolve to a safe generic label, still permissive", () => {
		expect(resolveProviderImageQuirks(null).supportedImageMimeTypes).toEqual(DEFAULT_SUPPORTED_IMAGE_MIME_TYPES);
		expect(resolveProviderImageQuirks("  ").label).toBe("the model server");
	});

	it("mime comparison is case/space-insensitive", () => {
		const quirks = resolveProviderImageQuirks("lm-studio");
		expect(checkImageAgainstProvider("  IMAGE/PNG  ", quirks)).toEqual({ ok: true });
	});
});

/**
 * Deterministic visual-verification gate (F12.87) — PURE core.
 *
 * Frontend is the measured weak spot of code LLMs (layout/size/position errors that unit tests never see), and the
 * research-backed fix needs NO vision model: render the route, then gate on (a) it rendered at all, (b) zero console
 * errors, (c) a pixel-diff against a golden baseline under a `maxDiffPixelRatio` — Playwright's `toHaveScreenshot`
 * semantics, reimplemented dependency-free so the agent-side delivery gate can consume raw RGBA buffers from ANY
 * screenshot source (the preview browser, Playwright, a headless shot in the sandbox). Pure/total/deterministic —
 * the caller does the rendering/screenshotting; this module only compares and decides.
 */

export interface RgbaImage {
	readonly width: number;
	readonly height: number;
	/** RGBA, 4 bytes per pixel, row-major — width*height*4 long. */
	readonly data: Uint8Array | Uint8ClampedArray;
}

export interface PixelDiffOptions {
	/** Per-pixel color distance (0–1, YIQ-weighted) above which a pixel counts as different. Default 0.1 —
	 * tolerates anti-aliasing/subpixel noise while catching real color/layout changes. */
	readonly colorThreshold?: number;
}

export interface PixelDiffResult {
	readonly comparable: boolean;
	/** Differing pixels (0 when not comparable). */
	readonly diffPixels: number;
	readonly totalPixels: number;
	/** diffPixels / totalPixels (0 when not comparable). */
	readonly diffRatio: number;
	readonly reason: string;
}

/** Perceptual (YIQ-luma-weighted) color distance between two RGBA pixels, normalized to 0–1. */
function pixelDistance(a: RgbaImage["data"], b: RgbaImage["data"], offset: number): number {
	const dr = (a[offset] ?? 0) - (b[offset] ?? 0);
	const dg = (a[offset + 1] ?? 0) - (b[offset + 1] ?? 0);
	const db = (a[offset + 2] ?? 0) - (b[offset + 2] ?? 0);
	const da = (a[offset + 3] ?? 255) - (b[offset + 3] ?? 255);
	// Luma-weighted channel mix (approximate human sensitivity), alpha treated as a full channel.
	const distance = Math.sqrt(0.299 * dr * dr + 0.587 * dg * dg + 0.114 * db * db + 0.25 * da * da);
	return distance / 255;
}

/**
 * Compare two RGBA screenshots. Size mismatch ⇒ NOT comparable (a resized viewport is a test-harness problem, not a
 * visual diff — flagging it as 100% different would drown the real signal). Per-pixel comparison with a perceptual
 * threshold that absorbs anti-aliasing noise.
 */
export function comparePixels(baseline: RgbaImage, actual: RgbaImage, options: PixelDiffOptions = {}): PixelDiffResult {
	if (baseline.width !== actual.width || baseline.height !== actual.height) {
		return {
			comparable: false,
			diffPixels: 0,
			totalPixels: 0,
			diffRatio: 0,
			reason: `size mismatch: baseline ${baseline.width}×${baseline.height} vs actual ${actual.width}×${actual.height} — align the viewport before comparing.`,
		};
	}
	const colorThreshold = options.colorThreshold ?? 0.1;
	const totalPixels = baseline.width * baseline.height;
	let diffPixels = 0;
	for (let i = 0; i < totalPixels; i++) {
		if (pixelDistance(baseline.data, actual.data, i * 4) > colorThreshold) {
			diffPixels++;
		}
	}
	const diffRatio = totalPixels === 0 ? 0 : diffPixels / totalPixels;
	return {
		comparable: true,
		diffPixels,
		totalPixels,
		diffRatio,
		reason: `${diffPixels}/${totalPixels} pixels differ (${(diffRatio * 100).toFixed(2)}%).`,
	};
}

export type VisualGateVerdict = "pass" | "fail" | "baseline_created";

export interface VisualGateInput {
	/** Did the route render at all (no blank/error page)? */
	readonly rendered: boolean;
	/** Console errors captured during the render (empty = clean). */
	readonly consoleErrors: readonly string[];
	/** Pixel comparison vs the golden baseline; null when no baseline exists yet (first run). */
	readonly pixelDiff: PixelDiffResult | null;
	/** Maximum tolerated diff ratio (Playwright default-ish). Default 0.01 (1%). */
	readonly maxDiffPixelRatio?: number;
}

export interface VisualGateDecision {
	readonly verdict: VisualGateVerdict;
	readonly reason: string;
}

/**
 * Gate a frontend change. Ordered checks, cheapest/hardest-failure first:
 *   1. did not render ⇒ FAIL (nothing else matters);
 *   2. console errors ⇒ FAIL (a rendering page that throws is broken even if pixels match);
 *   3. no baseline ⇒ BASELINE_CREATED (the caller persists the shot as golden — first run passes by definition);
 *   4. non-comparable diff (size mismatch) ⇒ FAIL with the harness hint;
 *   5. diffRatio > maxDiffPixelRatio ⇒ FAIL, else PASS.
 */
export function decideVisualGate(input: VisualGateInput): VisualGateDecision {
	if (!input.rendered) {
		return { verdict: "fail", reason: "the route did not render — fix the page before visual comparison." };
	}
	if (input.consoleErrors.length > 0) {
		const preview = input.consoleErrors
			.slice(0, 3)
			.map((error) => error.slice(0, 120))
			.join(" | ");
		return {
			verdict: "fail",
			reason: `${input.consoleErrors.length} console error(s) during render: ${preview}`,
		};
	}
	if (input.pixelDiff === null) {
		return {
			verdict: "baseline_created",
			reason: "no golden baseline existed — this render becomes the baseline.",
		};
	}
	if (!input.pixelDiff.comparable) {
		return { verdict: "fail", reason: input.pixelDiff.reason };
	}
	const maxDiffPixelRatio = input.maxDiffPixelRatio ?? 0.01;
	if (input.pixelDiff.diffRatio > maxDiffPixelRatio) {
		return {
			verdict: "fail",
			reason: `visual diff ${(input.pixelDiff.diffRatio * 100).toFixed(2)}% exceeds the ${(maxDiffPixelRatio * 100).toFixed(2)}% budget — ${input.pixelDiff.reason}`,
		};
	}
	return {
		verdict: "pass",
		reason: `rendered clean; visual diff ${(input.pixelDiff.diffRatio * 100).toFixed(2)}% within the ${(maxDiffPixelRatio * 100).toFixed(2)}% budget.`,
	};
}

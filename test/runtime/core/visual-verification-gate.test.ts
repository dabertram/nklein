import { describe, expect, it } from "vitest";
import { comparePixels, decideVisualGate, type RgbaImage } from "../../../src/core/visual-verification-gate";

/** Solid-color RGBA image. */
function solid(width: number, height: number, [r, g, b, a]: [number, number, number, number]): RgbaImage {
	const data = new Uint8Array(width * height * 4);
	for (let i = 0; i < width * height; i++) {
		data[i * 4] = r;
		data[i * 4 + 1] = g;
		data[i * 4 + 2] = b;
		data[i * 4 + 3] = a;
	}
	return { width, height, data };
}

describe("comparePixels", () => {
	it("reports zero diff for identical images", () => {
		const image = solid(10, 10, [30, 60, 90, 255]);
		const result = comparePixels(image, solid(10, 10, [30, 60, 90, 255]));
		expect(result).toMatchObject({ comparable: true, diffPixels: 0, diffRatio: 0 });
	});

	it("tolerates sub-threshold anti-aliasing noise but catches a real color change", () => {
		const base = solid(10, 10, [100, 100, 100, 255]);
		const noisy = solid(10, 10, [104, 102, 101, 255]); // tiny AA-ish shift
		expect(comparePixels(base, noisy).diffPixels).toBe(0);
		const changed = solid(10, 10, [200, 100, 100, 255]); // real change
		expect(comparePixels(base, changed).diffPixels).toBe(100);
	});

	it("counts a partial region change proportionally", () => {
		const base = solid(10, 10, [0, 0, 0, 255]);
		const actual = solid(10, 10, [0, 0, 0, 255]);
		// paint a 2x10 stripe white (20 pixels)
		for (let i = 0; i < 20; i++) {
			(actual.data as Uint8Array)[i * 4] = 255;
			(actual.data as Uint8Array)[i * 4 + 1] = 255;
			(actual.data as Uint8Array)[i * 4 + 2] = 255;
		}
		const result = comparePixels(base, actual);
		expect(result.diffPixels).toBe(20);
		expect(result.diffRatio).toBeCloseTo(0.2, 5);
	});

	it("refuses size mismatches as not comparable (harness problem, not a visual diff)", () => {
		const result = comparePixels(solid(10, 10, [0, 0, 0, 255]), solid(12, 10, [0, 0, 0, 255]));
		expect(result.comparable).toBe(false);
		expect(result.reason).toContain("size mismatch");
	});
});

describe("decideVisualGate", () => {
	const cleanDiff = comparePixels(solid(10, 10, [0, 0, 0, 255]), solid(10, 10, [0, 0, 0, 255]));

	it("fails hard when the route did not render", () => {
		const decision = decideVisualGate({ rendered: false, consoleErrors: [], pixelDiff: cleanDiff });
		expect(decision.verdict).toBe("fail");
		expect(decision.reason).toContain("did not render");
	});

	it("fails on console errors even when pixels match", () => {
		const decision = decideVisualGate({
			rendered: true,
			consoleErrors: ["TypeError: x is undefined", "Warning-as-error"],
			pixelDiff: cleanDiff,
		});
		expect(decision.verdict).toBe("fail");
		expect(decision.reason).toContain("2 console error(s)");
	});

	it("creates the baseline on first run (no golden yet)", () => {
		const decision = decideVisualGate({ rendered: true, consoleErrors: [], pixelDiff: null });
		expect(decision.verdict).toBe("baseline_created");
	});

	it("fails when the diff exceeds the budget and passes within it", () => {
		const base = solid(10, 10, [0, 0, 0, 255]);
		const changed = solid(10, 10, [0, 0, 0, 255]);
		for (let i = 0; i < 5; i++) {
			(changed.data as Uint8Array)[i * 4] = 255; // 5% of pixels
		}
		const bigDiff = comparePixels(base, changed);
		expect(
			decideVisualGate({ rendered: true, consoleErrors: [], pixelDiff: bigDiff, maxDiffPixelRatio: 0.01 }).verdict,
		).toBe("fail");
		expect(
			decideVisualGate({ rendered: true, consoleErrors: [], pixelDiff: bigDiff, maxDiffPixelRatio: 0.1 }).verdict,
		).toBe("pass");
	});

	it("fails on a non-comparable diff with the harness hint", () => {
		const mismatch = comparePixels(solid(10, 10, [0, 0, 0, 255]), solid(12, 10, [0, 0, 0, 255]));
		const decision = decideVisualGate({ rendered: true, consoleErrors: [], pixelDiff: mismatch });
		expect(decision.verdict).toBe("fail");
		expect(decision.reason).toContain("size mismatch");
	});
});

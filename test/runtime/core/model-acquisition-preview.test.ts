import { describe, expect, it } from "vitest";
import { buildModelAcquisitionPreview } from "../../../src/core/model-acquisition-preview";

const GIB = 1024 ** 3;

/**
 * P25.3 phase-3: the shared preview builder the CLI and the web view both render — one source of truth for
 * format safety, size, publisher, and fit, so the two surfaces can never disagree.
 */
describe("buildModelAcquisitionPreview", () => {
	const base = {
		modelKey: "qwen/qwen3.5-9b",
		sizeBytes: Math.round(5.2 * GIB),
		publisher: "lmstudio-community",
		allowedPublishers: [] as string[],
		paramB: 9,
		weightBitsPerParam: 4,
		contextTokens: 32_768,
		budgetBytes: 128 * GIB,
		budgetSource: "NKLEIN_DEVICE_RAM_GB",
	};

	it("marks weights-only formats safe and pickle/undeclared unsafe", () => {
		expect(buildModelAcquisitionPreview({ ...base, format: "mlx" }).format.safe).toBe(true);
		expect(buildModelAcquisitionPreview({ ...base, format: "safetensors" }).format.safe).toBe(true);
		const pickle = buildModelAcquisitionPreview({ ...base, format: "pickle" });
		expect(pickle.format.safe).toBe(false);
		expect(pickle.format.label).toContain("REFUSED");
		const undeclared = buildModelAcquisitionPreview({ ...base, format: null });
		expect(undeclared.format.safe).toBe(false);
		expect(undeclared.format.label).toContain("UNDECLARED");
	});

	it("produces a fit verdict from the residency math when paramB is known", () => {
		const preview = buildModelAcquisitionPreview({ ...base, format: "mlx" });
		expect(preview.fit.known).toBe(true);
		if (preview.fit.known) {
			expect(["fits", "tight", "exceeds"]).toContain(preview.fit.verdict);
			expect(preview.fit.needBytes).toBeGreaterThan(0);
			expect(preview.fit.budgetBytes).toBe(128 * GIB);
		}
	});

	it("abstains on fit when the parameter count is unknown — never guesses", () => {
		const preview = buildModelAcquisitionPreview({ ...base, format: "mlx", paramB: null });
		expect(preview.fit.known).toBe(false);
		expect(preview.fit.label).toContain("unknown");
	});

	it("renders size and publisher (with an allow-list) honestly", () => {
		const withList = buildModelAcquisitionPreview({
			...base,
			format: "mlx",
			allowedPublishers: ["lmstudio-community", "qwen"],
		});
		expect(withList.sizeLabel).toContain("5.2 GiB");
		expect(withList.publisherLabel).toContain("allow-list: lmstudio-community, qwen");
		const undeclaredSize = buildModelAcquisitionPreview({ ...base, format: "mlx", sizeBytes: null });
		expect(undeclaredSize.sizeLabel).toContain("undeclared");
	});
});

import { describe, expect, it } from "vitest";
import { selectCacheFriendlyVariant } from "../../../src/core/cache-friendly-route";

describe("selectCacheFriendlyVariant", () => {
	it("routes a hybrid model (gpt-oss) to the GGUF build over MLX (#1697)", () => {
		const out = selectCacheFriendlyVariant({
			variants: [
				{ modelId: "gpt-oss-20b", engine: "mlx", format: "mlx" },
				{ modelId: "gpt-oss-20b", engine: "llama.cpp", format: "gguf" },
			],
		});
		expect(out.chosen?.format).toBe("gguf");
		expect(out.reason).toContain("GGUF");
	});

	it("keeps the first variant for a full-attention model (every build caches)", () => {
		const out = selectCacheFriendlyVariant({
			variants: [
				{ modelId: "llama-3.3-70b", engine: "mlx", format: "mlx" },
				{ modelId: "llama-3.3-70b", engine: "llama.cpp", format: "gguf" },
			],
		});
		// full_attention → first kept (even though it's MLX, it caches fine).
		expect(out.chosen?.format).toBe("mlx");
		expect(out.reason).toContain("full_attention");
	});

	it("flags an MLX-only hybrid (no GGUF to route to — probe to confirm)", () => {
		const out = selectCacheFriendlyVariant({
			variants: [{ modelId: "qwen3.5-35b-a3b", engine: "mlx", format: "mlx" }],
		});
		expect(out.chosen?.format).toBe("mlx");
		expect(out.reason).toMatch(/only MLX|probe/i);
	});

	it("keeps a non-MLX hybrid variant when GGUF is absent but another format exists", () => {
		const out = selectCacheFriendlyVariant({
			variants: [
				{ modelId: "gemma-3-27b", engine: "mlx", format: "mlx" },
				{ modelId: "gemma-3-27b", engine: "other", format: "safetensors" },
			],
		});
		expect(out.chosen?.format).toBe("safetensors");
	});

	it("returns null for no variants", () => {
		expect(selectCacheFriendlyVariant({ variants: [] })).toEqual({ chosen: null, reason: "no variants" });
	});
});

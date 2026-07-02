import { describe, expect, it } from "vitest";
import { isLineageDiverse, modelsShareLineage, resolveLineage } from "../../../src/core/model-lineage";

describe("resolveLineage", () => {
	it("resolves the live fleet's real model ids to their coarse lineages", () => {
		expect(resolveLineage("openai/gpt-oss-120b")).toBe("gpt-oss");
		expect(resolveLineage("qwopus3.5-4b-coder-mtp")).toBe("qwen");
		expect(resolveLineage("mlx-qwopus3.5-27b-v3")).toBe("qwen");
		expect(resolveLineage("qwen3.5-9b-mlx")).toBe("qwen");
		expect(resolveLineage("ornith-1.0-9b")).toBe("qwen"); // qwen3.5 arch (DECIDED: one qwen lineage)
		expect(resolveLineage("nvidia/nemotron-3-nano-4b")).toBe("nemotron");
		expect(resolveLineage("phi-4-reasoning-plus")).toBe("phi");
		expect(resolveLineage("gemma-4-12b-it-qat")).toBe("gemma");
		expect(resolveLineage("mistralai/devstral-small-2-2512")).toBe("mistral");
		expect(resolveLineage("meta/llama-3.3-70b")).toBe("llama");
	});

	it("an R1 distill counts as deepseek even on a qwen/llama base (training dominates blind spots)", () => {
		expect(resolveLineage("deepseek/deepseek-r1-0528-qwen3-8b")).toBe("deepseek");
		expect(resolveLineage("r1-distill-llama-8b")).toBe("deepseek");
	});

	it("a per-machine alias or unknown family resolves to unknown", () => {
		expect(resolveLineage("coder-gpu")).toBe("unknown");
		expect(resolveLineage("granite-3.1-8b")).toBe("unknown");
	});
});

describe("modelsShareLineage / isLineageDiverse", () => {
	it("flags the live monoculture regression: two qwen3_x variants share a lineage", () => {
		expect(modelsShareLineage("qwopus3.6-27b-v2-mlx", "qwopus3.5-4b-coder-mtp")).toBe(true);
		expect(isLineageDiverse("qwopus3.6-27b-v2-mlx", "qwopus3.5-4b-coder-mtp")).toBe(false);
	});

	it("architect=reviewer same model shares (the gpt-oss monoculture)", () => {
		expect(modelsShareLineage("openai/gpt-oss-120b", "openai/gpt-oss-120b")).toBe(true);
	});

	it("gpt-oss vs qwen is a guaranteed-diverse decision pair", () => {
		expect(isLineageDiverse("openai/gpt-oss-120b", "qwen3.5-9b-mlx")).toBe(true);
	});

	it("unknown never shares AND never counts as diverse (non-diverse-safe)", () => {
		expect(modelsShareLineage("coder-gpu", "coder-gpu")).toBe(false);
		expect(isLineageDiverse("coder-gpu", "openai/gpt-oss-120b")).toBe(false);
	});
});

import { describe, expect, it } from "vitest";
import {
	type AttentionArch,
	classifyAttentionArchitecture,
	isLikelyCacheFriendly,
} from "../../../src/core/cache-friendly-arch";

describe("classifyAttentionArchitecture (todo §5.AQ-E cache-friendliness PRE-filter)", () => {
	it("classifies GPT-OSS as SWA (LM Studio #1697 / mlx-lm #980) — not cache-friendly", () => {
		const arch = classifyAttentionArchitecture({ modelId: "gpt-oss-20b" });
		expect(arch).toBe<AttentionArch>("hybrid_swa");
		expect(isLikelyCacheFriendly(arch)).toBe(false);
	});

	it("classifies Gemma 3 and Gemma 4 as SWA", () => {
		expect(classifyAttentionArchitecture({ modelId: "gemma-3-27b-it" })).toBe<AttentionArch>("hybrid_swa");
		expect(classifyAttentionArchitecture({ modelId: "gemma-4-12b" })).toBe<AttentionArch>("hybrid_swa");
	});

	it("classifies Qwen3.5 / Falcon-H1 / Jamba as SSM-hybrids (mlx-lm #980, llama.cpp #20225)", () => {
		expect(classifyAttentionArchitecture({ modelId: "qwen3.5-30b-a3b" })).toBe<AttentionArch>("hybrid_ssm");
		expect(classifyAttentionArchitecture({ modelId: "falcon-h1-34b" })).toBe<AttentionArch>("hybrid_ssm");
		expect(classifyAttentionArchitecture({ modelId: "jamba-1.5-large" })).toBe<AttentionArch>("hybrid_ssm");
	});

	it("classifies Llama / Mistral / Qwen2.5 / MiniMax as full attention → cache-friendly", () => {
		for (const modelId of ["llama-3.3-70b-instruct", "mistral-large", "qwen2.5-coder-32b", "minimax-m2.5"]) {
			const arch = classifyAttentionArchitecture({ modelId });
			expect(arch).toBe<AttentionArch>("full_attention");
			expect(isLikelyCacheFriendly(arch)).toBe(true);
		}
	});

	it("keeps a full-attention MoE as full_attention (plain MoE does NOT break caching — MiniMax = attention+MoE)", () => {
		const arch = classifyAttentionArchitecture({ modelId: "minimax-m2.5", isMoe: true });
		expect(arch).toBe<AttentionArch>("full_attention");
		expect(isLikelyCacheFriendly(arch)).toBe(true);
	});

	it("ignores isMoe entirely — it never flips the verdict either way", () => {
		// Same id, both isMoe values → same architecture verdict.
		expect(classifyAttentionArchitecture({ modelId: "llama-3.1-8b", isMoe: true })).toBe(
			classifyAttentionArchitecture({ modelId: "llama-3.1-8b", isMoe: false }),
		);
		// A broken architecture stays broken regardless of MoE-ness.
		expect(classifyAttentionArchitecture({ modelId: "qwen3.5-30b", isMoe: true })).toBe<AttentionArch>("hybrid_ssm");
	});

	it("prefers the more-broken verdict when an id matches multiple families (ssm > swa > full)", () => {
		// Contrived id touching all three families: the safe (most-broken) SSM verdict must win.
		expect(classifyAttentionArchitecture({ modelId: "llama-gemma3-mamba-frankenmerge" })).toBe<AttentionArch>(
			"hybrid_ssm",
		);
		// SWA + full → SWA wins over full.
		expect(classifyAttentionArchitecture({ modelId: "gpt-oss-llama-merge" })).toBe<AttentionArch>("hybrid_swa");
	});

	it("returns 'unknown' for an unrecognised id → not cache-friendly (probe to confirm)", () => {
		const arch = classifyAttentionArchitecture({ modelId: "some-brand-new-model-42b" });
		expect(arch).toBe<AttentionArch>("unknown");
		expect(isLikelyCacheFriendly(arch)).toBe(false);
	});

	it("is case-insensitive on the model id", () => {
		expect(classifyAttentionArchitecture({ modelId: "GPT-OSS-120B" })).toBe<AttentionArch>("hybrid_swa");
		expect(classifyAttentionArchitecture({ modelId: "Qwen3.5-MoE" })).toBe<AttentionArch>("hybrid_ssm");
		expect(classifyAttentionArchitecture({ modelId: "LLaMA-3" })).toBe<AttentionArch>("full_attention");
	});
});

describe("isLikelyCacheFriendly (PRE-filter verdict)", () => {
	it("is true ONLY for full_attention; hybrids and unknown are false", () => {
		expect(isLikelyCacheFriendly("full_attention")).toBe(true);
		expect(isLikelyCacheFriendly("hybrid_swa")).toBe(false);
		expect(isLikelyCacheFriendly("hybrid_ssm")).toBe(false);
		expect(isLikelyCacheFriendly("unknown")).toBe(false);
	});
});

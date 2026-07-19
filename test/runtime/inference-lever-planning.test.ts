import { describe, expect, it } from "vitest";
import {
	assessQuantizationFloor,
	planThinkingBudget,
	readQuantization,
	toReasoningEffort,
} from "../../src/core/inference-lever-planning";

describe("readQuantization", () => {
	it("reads a GGUF k-quant into width, tier and k-flag", () => {
		expect(readQuantization("qwen3-14b-q4_k_m")).toEqual({
			quant: "q4_k_m",
			bits: 4,
			variantTier: 4,
			kQuant: true,
		});
	});

	it("reads an MLX @Nbit alias as a width with no stated k-quant tier", () => {
		const reading = readQuantization("ornith-1.0-35b-mlx@8bit");
		expect(reading.bits).toBe(8);
		expect(reading.kQuant).toBe(false);
		expect(reading.variantTier).toBe(0);
	});

	it("reports nulls for an id that carries no quant token at all", () => {
		expect(readQuantization("qwen2.5-coder-14b")).toEqual({
			quant: null,
			bits: null,
			variantTier: 0,
			kQuant: false,
		});
	});

	it("reads an imatrix quant's width", () => {
		expect(readQuantization("model-iq3_xxs").bits).toBe(3);
	});
});

describe("assessQuantizationFloor", () => {
	it("clears Q4_K_M", () => {
		const assessment = assessQuantizationFloor({ modelId: "qwen3-14b-q4_k_m", role: "worker" });
		expect(assessment.verdict).toBe("ok");
	});

	it("clears a quant above the floor", () => {
		expect(assessQuantizationFloor({ modelId: "model-q8_0", role: "worker" }).verdict).toBe("ok");
		expect(assessQuantizationFloor({ modelId: "model-mlx@8bit", role: "worker" }).verdict).toBe("ok");
	});

	it("rejects Q3 and below — tool-call reliability goes first", () => {
		const assessment = assessQuantizationFloor({ modelId: "model-q3_k_m", role: "worker" });
		expect(assessment.verdict).toBe("below_floor");
		expect(assessment.reason).toContain("3-bit");
	});

	it("rejects a legacy 4-bit variant at the SAME width as the floor", () => {
		// q4_0 is 4-bit but not a K_M k-quant — same width is not the same reliability.
		const assessment = assessQuantizationFloor({ modelId: "model-q4_0", role: "worker" });
		expect(assessment.verdict).toBe("below_floor");
		expect(assessment.reason).toContain("K_M");
	});

	it("rejects a 4-bit k-quant below the medium tier", () => {
		expect(assessQuantizationFloor({ modelId: "model-q4_k_s", role: "worker" }).verdict).toBe("below_floor");
	});

	it("accepts a 4-bit k-quant ABOVE the medium tier", () => {
		expect(assessQuantizationFloor({ modelId: "model-q4_k_xl", role: "worker" }).verdict).toBe("ok");
	});

	it("reports an id with no quant token as unknown — never as a pass", () => {
		const assessment = assessQuantizationFloor({ modelId: "qwen2.5-coder-14b", role: "worker" });
		expect(assessment.verdict).toBe("unknown");
		expect(assessment.verdict).not.toBe("ok");
		expect(assessment.reason).toContain("not cleared");
	});

	it("grades severity by what a malformed tool call actually costs in that role", () => {
		expect(assessQuantizationFloor({ modelId: "model-q3_k_m", role: "worker" }).severity).toBe("high");
		expect(assessQuantizationFloor({ modelId: "model-q3_k_m", role: "architect" }).severity).toBe("high");
		expect(assessQuantizationFloor({ modelId: "model-q3_k_m", role: "reviewer" }).severity).toBe("medium");
	});

	it("never throws on a junk id", () => {
		expect(() => assessQuantizationFloor({ modelId: "", role: "worker" })).not.toThrow();
		expect(assessQuantizationFloor({ modelId: "", role: "worker" }).verdict).toBe("unknown");
	});
});

describe("planThinkingBudget", () => {
	it("disables the lever when the model has no reasoning channel", () => {
		const plan = planThinkingBudget({ difficulty: 0.9, expectedToolCalls: 0, supportsThinking: false });
		expect(plan.level).toBe("none");
	});

	it("spends on a hard card with a short tool chain", () => {
		expect(planThinkingBudget({ difficulty: 0.9, expectedToolCalls: 1, supportsThinking: true }).level).toBe("high");
	});

	it("scales down with difficulty", () => {
		expect(planThinkingBudget({ difficulty: 0.5, expectedToolCalls: 1, supportsThinking: true }).level).toBe(
			"medium",
		);
		expect(planThinkingBudget({ difficulty: 0.1, expectedToolCalls: 1, supportsThinking: true }).level).toBe("low");
	});

	it("pulls thinking BACK on a tool-dense turn even when the card is hard", () => {
		const dense = planThinkingBudget({ difficulty: 0.9, expectedToolCalls: 8, supportsThinking: true });
		const sparse = planThinkingBudget({ difficulty: 0.9, expectedToolCalls: 1, supportsThinking: true });
		expect(dense.level).toBe("low");
		expect(sparse.level).toBe("high");
		expect(dense.reason).toContain("mid-chain-of-thought");
	});

	it("drops to none when a tool-dense turn is also easy", () => {
		expect(planThinkingBudget({ difficulty: 0.2, expectedToolCalls: 8, supportsThinking: true }).level).toBe("none");
	});

	it("treats a non-finite difficulty as maximally hard", () => {
		expect(planThinkingBudget({ difficulty: Number.NaN, expectedToolCalls: 1, supportsThinking: true }).level).toBe(
			"high",
		);
	});

	it("treats a non-finite tool-call count as tool-dense (the cautious read)", () => {
		expect(planThinkingBudget({ difficulty: 0.9, expectedToolCalls: Number.NaN, supportsThinking: true }).level).toBe(
			"low",
		);
	});
});

describe("toReasoningEffort", () => {
	it("maps a none budget to null rather than collapsing it to low", () => {
		// The provider enum has no off switch — abstaining must not become "think a little".
		expect(toReasoningEffort("none")).toBeNull();
	});

	it("passes the spending levels through unchanged", () => {
		expect(toReasoningEffort("low")).toBe("low");
		expect(toReasoningEffort("medium")).toBe("medium");
		expect(toReasoningEffort("high")).toBe("high");
	});
});

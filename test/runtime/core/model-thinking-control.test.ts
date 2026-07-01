import { describe, expect, it } from "vitest";
import {
	applyThinkingDisable,
	getThinkingControl,
	isReasoningModel,
	isRecognizedModelFamily,
	supportsThinkingControl,
} from "../../../src/core/model-thinking-control";

describe("getThinkingControl / supportsThinkingControl", () => {
	it("recognizes Qwen3's /no_think soft switch (live-verified) but not non-reasoning qwen variants", () => {
		expect(getThinkingControl("qwen/qwen3-8b")).toEqual({ disableToken: "/no_think", enableToken: "/think" });
		expect(supportsThinkingControl("qwen3-30b-a3b")).toBe(true);
		// qwen2.5-coder is NOT a reasoning model — no switch.
		expect(getThinkingControl("qwen2.5-coder-14b")).toBeNull();
		expect(supportsThinkingControl("phi-4-mini")).toBe(false);
	});

	it("EXCLUDES R1 distills that are qwen3-arch but always reason (live-verified: /no_think ignored)", () => {
		// deepseek-r1-0528-qwen3-8b contains "qwen3" but ignores /no_think — must NOT get a switch.
		expect(getThinkingControl("deepseek/deepseek-r1-0528-qwen3-8b")).toBeNull();
		expect(supportsThinkingControl("deepseek/deepseek-r1-0528-qwen3-8b")).toBe(false);
		// a plain qwen3 (no r1/deepseek marker) still gets the switch.
		expect(supportsThinkingControl("qwen/qwen3-8b")).toBe(true);
	});

	it("EXCLUDES qwen3.5 — matches /qwen3/ by name but IGNORES /no_think (live-verified 2026-07-01)", () => {
		// qwen3.5 (arch qwen3_5) is NOT the qwen3 that honors the soft switch — it always reasons; no switch.
		expect(getThinkingControl("qwen3.5-9b-mlx-m4")).toBeNull();
		expect(getThinkingControl("qwen3.5-9b-mtp-q4-k-xl-legion5pro")).toBeNull();
		expect(supportsThinkingControl("qwen3.5-9b")).toBe(false);
		expect(applyThinkingDisable("Do it.", "qwen3.5-9b-mlx-m4")).toBe("Do it."); // no-op, not a false /no_think
		// the real qwen3 is unaffected by the exclusion.
		expect(supportsThinkingControl("qwen3-8b")).toBe(true);
	});
});

describe("applyThinkingDisable", () => {
	it("appends the disable token for a supported model", () => {
		expect(applyThinkingDisable("Create a card titled X.", "qwen/qwen3-8b")).toBe(
			"Create a card titled X. /no_think",
		);
	});

	it("is a no-op for a model without a known switch", () => {
		expect(applyThinkingDisable("Do the thing.", "qwen2.5-coder-14b")).toBe("Do the thing.");
	});

	it("does not double-append when the switch is already present", () => {
		const once = applyThinkingDisable("Go. /no_think", "qwen/qwen3-8b");
		expect(once).toBe("Go. /no_think");
	});
});

describe("isReasoningModel", () => {
	// Resident reasoning ids (from `lms ps`, 2026-07-01) + the switchable/other reasoning families.
	const reasoning = [
		"qwen3.5-9b-mlx", // resident — arch qwen3_5; ALWAYS reasons
		"qwopus3.6-27b-v2-mlx", // resident — capable 27B reasoner (json_schema dead-ends here too)
		"deepseek-r1-0528-qwen3-8b", // resident — R1 distill
		"phi-4-mini-reasoning", // resident — the -reasoning tag
		"magistral-small", // resident — Mistral's reasoning model
		"qwen/qwen3-8b", // switchable qwen3
		"qwen3-30b-a3b",
		"qwen-3-14b", // dashed qwen-3 spelling
		"qwq-32b", // qwen2-arch reasoner
		"phi-4-reasoning-plus",
		"acme-thinking-13b", // generic -thinking tag
		"foo/bar-reasoning", // generic -reasoning tag with an org prefix
	];
	for (const id of reasoning) {
		it(`is TRUE for reasoning id "${id}"`, () => {
			expect(isReasoningModel(id)).toBe(true);
		});
	}

	// Resident non-reasoning ids (from `lms ps`) + other recognized non-reasoning families.
	const nonReasoning = [
		"qwen2.5-coder-14b", // resident
		"phi-4-mini-instruct", // resident — the -instruct Phi-4, NOT reasoning
		"gemma-4-e2b", // resident
		"mistral-small", // resident — non-magistral
		"llama-3.3-70b", // resident
		"qwen2.5-7b", // plain qwen2.5
		"ministral-8b",
		"gemma-4-e4b",
	];
	for (const id of nonReasoning) {
		it(`is FALSE for non-reasoning id "${id}"`, () => {
			expect(isReasoningModel(id)).toBe(false);
		});
	}

	it("does NOT confuse the -reasoning/-instruct Phi-4 variants", () => {
		expect(isReasoningModel("phi-4-mini-reasoning")).toBe(true);
		expect(isReasoningModel("phi-4-mini-instruct")).toBe(false);
		expect(isReasoningModel("phi-4-reasoning")).toBe(true);
	});

	it("does NOT read plain mistral as the magistral reasoner (no prefix collision)", () => {
		expect(isReasoningModel("magistral-small")).toBe(true);
		expect(isReasoningModel("mistral-small")).toBe(false);
		expect(isReasoningModel("mistral-nemo-12b")).toBe(false);
	});

	it("is case-insensitive", () => {
		expect(isReasoningModel("Qwen3.5-9B-MLX")).toBe(true);
		expect(isReasoningModel("MAGISTRAL-SMALL")).toBe(true);
		expect(isReasoningModel("QWEN2.5-CODER-14B")).toBe(false);
	});

	it("is FALSE for an unknown/unrecognized id (plain heuristic, not an allowlist)", () => {
		expect(isReasoningModel("totally-unknown-model")).toBe(false);
		expect(isReasoningModel("")).toBe(false);
	});

	it("agrees with getThinkingControl on the qwen3-switch boundary (single source of truth)", () => {
		// qwen3.5 is a reasoning model but has NO soft switch (excluded); switchable qwen3 is both.
		expect(isReasoningModel("qwen3.5-9b-mlx")).toBe(true);
		expect(supportsThinkingControl("qwen3.5-9b-mlx")).toBe(false);
		expect(isReasoningModel("qwen3-8b")).toBe(true);
		expect(supportsThinkingControl("qwen3-8b")).toBe(true);
	});
});

describe("isRecognizedModelFamily", () => {
	it("is TRUE for known reasoning families", () => {
		expect(isRecognizedModelFamily("qwen3.5-9b-mlx")).toBe(true);
		expect(isRecognizedModelFamily("magistral-small")).toBe(true);
		expect(isRecognizedModelFamily("deepseek-r1-0528-qwen3-8b")).toBe(true);
	});

	it("is TRUE for known non-reasoning families", () => {
		expect(isRecognizedModelFamily("qwen2.5-coder-14b")).toBe(true);
		expect(isRecognizedModelFamily("phi-4-mini-instruct")).toBe(true);
		expect(isRecognizedModelFamily("gemma-4-e2b")).toBe(true);
		expect(isRecognizedModelFamily("mistral-small")).toBe(true);
		expect(isRecognizedModelFamily("llama-3.3-70b")).toBe(true);
		expect(isRecognizedModelFamily("ministral-8b")).toBe(true);
	});

	it("is FALSE for an UNKNOWN family (the signal to fall back conservatively)", () => {
		expect(isRecognizedModelFamily("totally-unknown-model")).toBe(false);
		expect(isRecognizedModelFamily("acme-llm-9000")).toBe(false);
		expect(isRecognizedModelFamily("")).toBe(false);
	});
});

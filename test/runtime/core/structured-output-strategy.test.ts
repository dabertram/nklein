import { describe, expect, it } from "vitest";
import {
	type StructuredOutputStrategy,
	selectStructuredOutputStrategy,
} from "../../../src/core/structured-output-strategy";

/**
 * Grounds the two live-probed §4A/§5.AN findings (2026-07-01):
 *  (1) response_format:json_schema DEAD-ENDS (empty content) on REASONING models ⇒ never pick json_schema for them.
 *  (2) native tool_call (tool_choice:required) WORKS on reasoning + non-reasoning ⇒ the reasoning-safe path + the
 *      universal unknown-model default.
 * Non-reasoning recognized families keep the STRONGER json_schema grammar guarantee.
 */

const strat = (id: string): StructuredOutputStrategy => selectStructuredOutputStrategy(id).strategy;

describe("selectStructuredOutputStrategy — REASONING models ⇒ native_tool_call (json_schema dead-ends)", () => {
	// Resident reasoning ids (from `lms ps`, 2026-07-01) plus the switchable/other reasoning families.
	const reasoningIds = [
		"qwen3.5-9b-mlx", // resident — the model json_schema was live-probed dead-ending on
		"qwopus3.6-27b-v2-mlx", // resident — the capable 27B; reproduces ⇒ family, not size
		"deepseek-r1-0528-qwen3-8b", // resident R1 distill (always reasons)
		"phi-4-mini-reasoning", // resident — the -reasoning tag
		"magistral-small", // resident — Mistral's reasoning model (distinct token from mistral)
		"qwen/qwen3-8b", // switchable qwen3 (still a reasoning model)
		"qwen3-30b-a3b",
		"qwq-32b", // qwen2-arch reasoner
		"some-model-thinking-v2", // generic -thinking tag
		"phi-4-reasoning-plus",
	];

	for (const id of reasoningIds) {
		it(`picks native_tool_call (confident) for reasoning id "${id}"`, () => {
			const decision = selectStructuredOutputStrategy(id);
			expect(decision.strategy).toBe("native_tool_call");
			expect(decision.confident).toBe(true);
			// NEVER json_schema on a reasoning model (the dead-end).
			expect(decision.strategy).not.toBe("json_schema_grammar");
			expect(decision.reason).toMatch(/reasoning/i);
		});
	}
});

describe("selectStructuredOutputStrategy — recognized NON-reasoning families ⇒ json_schema_grammar", () => {
	// Resident non-reasoning ids (from `lms ps`) + other recognized non-reasoning families.
	const nonReasoningIds = [
		"qwen2.5-coder-14b", // resident — json_schema live-verified WORKING here
		"phi-4-mini-instruct", // resident — the -instruct (NON-reasoning) Phi-4; must NOT be read as reasoning
		"gemma-4-e2b", // resident
		"mistral-small", // resident — non-magistral; must NOT collide with magistral
		"llama-3.3-70b", // resident
		"qwen/qwen2.5-coder-14b",
		"gemma-4-e4b",
		"ministral-8b",
	];

	for (const id of nonReasoningIds) {
		it(`picks json_schema_grammar (confident) for non-reasoning id "${id}"`, () => {
			const decision = selectStructuredOutputStrategy(id);
			expect(decision.strategy).toBe("json_schema_grammar");
			expect(decision.confident).toBe(true);
		});
	}

	it("distinguishes phi-4-mini-instruct (grammar) from phi-4-mini-reasoning (tool_call)", () => {
		expect(strat("phi-4-mini-instruct")).toBe("json_schema_grammar");
		expect(strat("phi-4-mini-reasoning")).toBe("native_tool_call");
	});

	it("distinguishes mistral-small (grammar) from magistral-small (tool_call)", () => {
		expect(strat("mistral-small")).toBe("json_schema_grammar");
		expect(strat("magistral-small")).toBe("native_tool_call");
	});
});

describe("selectStructuredOutputStrategy — UNKNOWN models ⇒ native_tool_call (safe universal default, not confident)", () => {
	const unknownIds = ["totally-unknown-model", "acme-llm-9000", "", "some/random-org/mystery-7b"];

	for (const id of unknownIds) {
		it(`picks native_tool_call but NOT confident for unknown id "${id || "<empty>"}"`, () => {
			const decision = selectStructuredOutputStrategy(id);
			expect(decision.strategy).toBe("native_tool_call");
			expect(decision.confident).toBe(false);
			// Crucially: never risk the silent json_schema dead-end on a model we can't vouch for.
			expect(decision.strategy).not.toBe("json_schema_grammar");
		});
	}
});

describe("selectStructuredOutputStrategy — forceProseExtract escape hatch", () => {
	it("forces prose_extract for a reasoning model (overrides native_tool_call)", () => {
		const decision = selectStructuredOutputStrategy("qwen3.5-9b-mlx", { forceProseExtract: true });
		expect(decision.strategy).toBe("prose_extract");
		expect(decision.confident).toBe(true);
	});

	it("forces prose_extract for a recognized non-reasoning model (overrides json_schema_grammar)", () => {
		expect(selectStructuredOutputStrategy("qwen2.5-coder-14b", { forceProseExtract: true }).strategy).toBe(
			"prose_extract",
		);
	});

	it("forces prose_extract for an unknown model (overrides the native_tool_call default)", () => {
		expect(selectStructuredOutputStrategy("acme-llm-9000", { forceProseExtract: true }).strategy).toBe(
			"prose_extract",
		);
	});

	it("forceProseExtract:false behaves as the default (no override)", () => {
		expect(selectStructuredOutputStrategy("qwen2.5-coder-14b", { forceProseExtract: false }).strategy).toBe(
			"json_schema_grammar",
		);
		expect(selectStructuredOutputStrategy("qwen3.5-9b-mlx", { forceProseExtract: false }).strategy).toBe(
			"native_tool_call",
		);
	});
});

describe("selectStructuredOutputStrategy — determinism & shape", () => {
	it("is deterministic (same id ⇒ identical decision)", () => {
		const a = selectStructuredOutputStrategy("qwen3.5-9b-mlx");
		const b = selectStructuredOutputStrategy("qwen3.5-9b-mlx");
		expect(a).toEqual(b);
	});

	it("always returns a non-empty reason and one of the three strategies", () => {
		for (const id of ["qwen3.5-9b", "qwen2.5-coder-14b", "unknown-x"]) {
			const decision = selectStructuredOutputStrategy(id);
			expect(decision.reason.length).toBeGreaterThan(0);
			expect(["json_schema_grammar", "native_tool_call", "prose_extract"]).toContain(decision.strategy);
		}
	});
});

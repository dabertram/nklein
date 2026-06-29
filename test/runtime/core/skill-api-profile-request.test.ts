import { describe, expect, it } from "vitest";
import { resolveApiProfileRequest } from "../../../src/core/skill-api-profile-request";

describe("resolveApiProfileRequest", () => {
	it("an empty/absent profile yields no levers", () => {
		const r = resolveApiProfileRequest(undefined, "qwen/qwen3-8b");
		expect(r.thinkingDirective).toBeNull();
		expect(r.preferStructuredOutput).toBe(false);
		expect(r.forceToolCall).toBe(false);
		expect(r.temperature).toBeNull();
		expect(r.notes).toEqual([]);
	});

	it("reasoning 'off' emits the disable soft-switch for a switch-capable model (Qwen3)", () => {
		const r = resolveApiProfileRequest({ reasoning: "off" }, "qwen/qwen3-8b");
		expect(r.thinkingDirective).toBe("/no_think");
		expect(r.notes.join(" ")).toMatch(/soft switch/);
	});

	it("reasoning 'high' emits the enable soft-switch for a switch-capable model", () => {
		const r = resolveApiProfileRequest({ reasoning: "high" }, "qwen/qwen3-8b");
		expect(r.thinkingDirective).toBe("/think");
	});

	it("reasoning intent on a model with NO known switch is recorded as a skipped note, not forced", () => {
		const r = resolveApiProfileRequest({ reasoning: "high" }, "mistralai/mistral-small-3.2");
		expect(r.thinkingDirective).toBeNull();
		expect(r.notes.join(" ")).toMatch(/no known thinking switch/);
	});

	it("an R1 distill (always-reasoning) gets no directive even though its id matches qwen3", () => {
		const r = resolveApiProfileRequest({ reasoning: "off" }, "deepseek-r1-0528-qwen3-8b");
		expect(r.thinkingDirective).toBeNull();
		expect(r.notes.join(" ")).toMatch(/no known thinking switch/);
	});

	it("reasoning 'low'/'inherit' emit no directive", () => {
		expect(resolveApiProfileRequest({ reasoning: "low" }, "qwen/qwen3-8b").thinkingDirective).toBeNull();
		expect(resolveApiProfileRequest({ reasoning: "inherit" }, "qwen/qwen3-8b").thinkingDirective).toBeNull();
	});

	it("passes through the model-agnostic levers (structured output, force-call, temperature)", () => {
		const r = resolveApiProfileRequest(
			{ structuredOutput: true, forceToolCall: true, temperature: 0.2 },
			"any-model",
		);
		expect(r.preferStructuredOutput).toBe(true);
		expect(r.forceToolCall).toBe(true);
		expect(r.temperature).toBe(0.2);
	});
});

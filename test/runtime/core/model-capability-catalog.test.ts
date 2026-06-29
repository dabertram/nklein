import { describe, expect, it } from "vitest";
import {
	assessModelSuitability,
	DEFAULT_MODEL_SUITABILITY_POLICY,
	lookupModelCapability,
	MODEL_CAPABILITY_CATALOG,
	resolveModelSuitabilityPolicy,
} from "../../../src/core/model-capability-catalog";

describe("model-capability-catalog: lookup", () => {
	it("resolves a known family from a served id / lms key, case- and quant-insensitively", () => {
		expect(lookupModelCapability("qwen/qwen3-8b")?.family).toBe("qwen3-8b");
		expect(lookupModelCapability("PHI-4-MINI-INSTRUCT@8bit")?.family).toBe("phi-4-mini-instruct");
		expect(lookupModelCapability("google/gemma-4-e2b")?.family).toBe("gemma-4-e2b");
	});

	it("matches the most SPECIFIC family first (reasoning before mini-instruct; e4b before a generic gemma-4)", () => {
		// phi-4-mini-reasoning must NOT fall through to the broader phi-4-mini(-instruct) pattern.
		expect(lookupModelCapability("microsoft/phi-4-mini-reasoning")?.family).toBe("phi-4-mini-reasoning");
		expect(lookupModelCapability("phi-4-reasoning-plus")?.family).toBe("phi-4-reasoning-plus");
		// e4b is distinct from e2b.
		expect(lookupModelCapability("google/gemma-4-e4b")?.family).toBe("gemma-4-e4b");
		expect(lookupModelCapability("google/gemma-4-e2b")?.family).toBe("gemma-4-e2b");
	});

	it("matches the Nemotron Nano line across generations (nemotron-nano, nemotron-3-nano, llama-3.1-nemotron-nano)", () => {
		// Regression: the `nemotron-3-nano-4b` generation must resolve (broadened matcher, live-confirmed TOOL_WEAK 2026-06-29).
		expect(lookupModelCapability("nvidia/nemotron-3-nano-4b")?.family).toBe("nemotron-nano");
		expect(lookupModelCapability("nvidia/llama-3.1-nemotron-nano-4b-v1.1")?.family).toBe("nemotron-nano");
		expect(lookupModelCapability("nemotron-nano")?.family).toBe("nemotron-nano");
	});

	it("returns null for a family not in the catalog", () => {
		expect(lookupModelCapability("some-obscure/model-v9")).toBeNull();
	});
});

describe("model-capability-catalog: suitability gate", () => {
	it("allows a TOOL_NATIVE model with severity ok", () => {
		const v = assessModelSuitability("qwen/qwen3-8b");
		expect(v.toolUse).toBe("TOOL_NATIVE");
		expect(v.severity).toBe("ok");
		expect(v.allowed).toBe(true);
	});

	it("rejects a TOOL_UNSUITABLE reasoning model under the default (reject) policy", () => {
		const v = assessModelSuitability("microsoft/phi-4-mini-reasoning");
		expect(v.toolUse).toBe("TOOL_UNSUITABLE");
		expect(v.severity).toBe("reject");
		expect(v.allowed).toBe(false);
		expect(v.reason).toMatch(/math reasoning only/i);
	});

	it("warns (not rejects) a TOOL_WEAK model", () => {
		const v = assessModelSuitability("deepseek/deepseek-r1-0528-qwen3-8b");
		expect(v.toolUse).toBe("TOOL_WEAK");
		expect(v.severity).toBe("warn");
		expect(v.allowed).toBe(false);
	});

	it("honors a hard severityOverride even though the verdict alone would pass (Nemotron-Mini 4k context)", () => {
		const v = assessModelSuitability("nvidia/nemotron-mini-4b-instruct");
		expect(v.toolUse).toBe("TOOL_CAPABLE"); // would be "ok" on the verdict alone…
		expect(v.severity).toBe("reject"); // …but the 4k-context override forces reject
		expect(v.reason).toMatch(/4k context/i);
	});

	it("surfaces the unverified caveat for a verdict we haven't confirmed (gemma-4-e4b)", () => {
		const v = assessModelSuitability("google/gemma-4-e4b");
		expect(v.reason).toMatch(/unverified/i);
	});

	it("defers an UNKNOWN model to policy.onUnknown (default warn) and explains how to investigate", () => {
		const v = assessModelSuitability("some-obscure/model-v9");
		expect(v.toolUse).toBe("UNKNOWN");
		expect(v.severity).toBe("warn");
		expect(v.entry).toBeNull();
		expect(v.reason).toMatch(/capability check|model sweep/i);
	});
});

describe("model-capability-catalog: policy resolution", () => {
	it("the shipped default is warn-and-reject (reject unsuitable, warn unknown)", () => {
		expect(DEFAULT_MODEL_SUITABILITY_POLICY).toEqual({ onUnsuitable: "reject", onUnknown: "warn" });
	});

	it("a project override wins per-field; unset fields inherit the global policy", () => {
		const merged = resolveModelSuitabilityPolicy(
			{ onUnsuitable: "reject", onUnknown: "warn" },
			{ onUnsuitable: "warn" },
		);
		expect(merged).toEqual({ onUnsuitable: "warn", onUnknown: "warn" });
	});

	it("a loosened onUnsuitable policy downgrades a plain unsuitable model to warn…", () => {
		const policy = resolveModelSuitabilityPolicy(undefined, { onUnsuitable: "warn" });
		expect(assessModelSuitability("microsoft/phi-4-mini-reasoning", policy).severity).toBe("warn");
	});

	it("…but a hard per-entry override is NOT loosened by a permissive policy", () => {
		const policy = resolveModelSuitabilityPolicy(undefined, { onUnsuitable: "warn" });
		// Nemotron-Mini's override is a reject regardless of policy (its base verdict is TOOL_CAPABLE anyway).
		expect(assessModelSuitability("nvidia/nemotron-mini-4b-instruct", policy).severity).toBe("reject");
	});
});

describe("model-capability-catalog: data integrity", () => {
	it("every entry carries a note and at least one source", () => {
		for (const entry of MODEL_CAPABILITY_CATALOG) {
			expect(entry.note.length, entry.family).toBeGreaterThan(0);
			expect(entry.sources.length, entry.family).toBeGreaterThan(0);
		}
	});
});
